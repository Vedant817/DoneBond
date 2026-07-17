// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title DoneBondRegistry
/// @notice Commits coding tasks and verification receipts, and escrows optional native rewards.
/// @dev Evidence remains offchain. The contract enforces only commitments, lifecycle, and accounting.
contract DoneBondRegistry is ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant PASSING_RECEIPT_TYPEHASH = keccak256(
        "PassingReceipt(uint256 taskId,bytes32 taskHash,bytes32 policyHash,address assignee,bytes32 evidenceHash,bytes32 commitHash,uint64 attestationExpiry)"
    );
    enum TaskStatus {
        None,
        Open,
        ReceiptSubmitted,
        Approved,
        Rejected,
        Cancelled,
        Expired
    }

    /// @dev The first slot packs creator, deadline, and status. The second packs assignee and reward.
    struct Task {
        address creator;
        uint64 deadline;
        TaskStatus status;
        address assignee;
        uint96 reward;
        bytes32 taskHash;
        bytes32 policyHash;
        bytes32 evidenceHash;
        bytes32 commitHash;
    }

    error TaskNotFound();
    error Unauthorized();
    error InvalidState();
    error InvalidHash();
    error InvalidAssignee();
    error InvalidVerifier();
    error InvalidAttestation();
    error AttestationExpired();
    error AttestationAlreadyUsed();
    error InvalidDeadline();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error NothingToWithdraw();
    error TransferFailed();
    error ValueTooLarge();

    event TaskCreated(
        uint256 indexed taskId,
        address indexed creator,
        address indexed assignee,
        bytes32 taskHash,
        bytes32 policyHash,
        uint256 reward,
        uint64 deadline
    );
    event ReceiptSubmitted(
        uint256 indexed taskId, address indexed assignee, bytes32 evidenceHash, bytes32 commitHash
    );
    event TaskApproved(uint256 indexed taskId, address indexed assignee, uint256 reward);
    event TaskRejected(uint256 indexed taskId, bytes32 reasonHash);
    event TaskCancelled(uint256 indexed taskId);
    event TaskExpired(uint256 indexed taskId);
    event WithdrawalCredited(address indexed account, uint256 amount, uint256 indexed taskId);
    event Withdrawn(address indexed account, uint256 amount);
    event VerifierAttestationConsumed(
        uint256 indexed taskId,
        bytes32 indexed attestationDigest,
        address indexed verifier,
        uint64 attestationExpiry
    );

    /// @notice Address authorized to attest that canonical evidence passed verification.
    address public immutable verifier;

    /// @notice ID that will be assigned to the next task. Zero is reserved for nonexistence.
    uint256 public nextTaskId = 1;

    /// @notice Task commitments and lifecycle data by onchain ID.
    mapping(uint256 taskId => Task task) public tasks;

    /// @notice Native currency credits an account may withdraw.
    mapping(address account => uint256 amount) public withdrawable;

    /// @notice Consumed EIP-712 attestation digests, preventing replay.
    mapping(bytes32 digest => bool consumed) public usedAttestations;

    /// @notice Aggregate reward still locked in open or receipt-submitted tasks.
    uint256 public totalLockedRewards;

    /// @notice Aggregate credited reward awaiting withdrawal.
    uint256 public totalWithdrawable;

    /// @param verifier_ Nonzero signer authorized to issue passing verification attestations.
    constructor(address verifier_) EIP712("DoneBondRegistry", "1") {
        if (verifier_ == address(0)) revert InvalidVerifier();
        verifier = verifier_;
    }

    /// @notice Creates a committed task and escrows `msg.value` as its optional reward.
    /// @param taskHash Commitment to the canonical task definition.
    /// @param policyHash Commitment to the canonical verification policy.
    /// @param assignee Address exclusively permitted to submit the receipt.
    /// @param deadline Zero for no deadline, otherwise the final timestamp at which submission is valid.
    /// @return taskId Newly allocated task ID.
    function createTask(bytes32 taskHash, bytes32 policyHash, address assignee, uint64 deadline)
        external
        payable
        returns (uint256 taskId)
    {
        if (taskHash == bytes32(0) || policyHash == bytes32(0)) revert InvalidHash();
        if (assignee == address(0)) revert InvalidAssignee();
        if (deadline != 0 && deadline <= block.timestamp) revert InvalidDeadline();
        if (msg.value > type(uint96).max) revert ValueTooLarge();

        taskId = nextTaskId++;
        tasks[taskId] = Task({
            creator: msg.sender,
            deadline: deadline,
            status: TaskStatus.Open,
            assignee: assignee,
            reward: uint96(msg.value),
            taskHash: taskHash,
            policyHash: policyHash,
            evidenceHash: bytes32(0),
            commitHash: bytes32(0)
        });
        totalLockedRewards += msg.value;

        emit TaskCreated(taskId, msg.sender, assignee, taskHash, policyHash, msg.value, deadline);
    }

    /// @notice Binds a task to one evidence bundle and exact Git commit.
    /// @param taskId Existing open task ID.
    /// @param evidenceHash Commitment to the canonical evidence bundle.
    /// @param commitHash Commitment derived from the full Git object ID.
    /// @param attestationExpiry Last timestamp at which the verifier attestation is valid.
    /// @param verifierSignature EIP-712 signature from the immutable passing-evidence verifier.
    function submitReceipt(
        uint256 taskId,
        bytes32 evidenceHash,
        bytes32 commitHash,
        uint64 attestationExpiry,
        bytes calldata verifierSignature
    ) external {
        Task storage task = _task(taskId);
        if (msg.sender != task.assignee) revert Unauthorized();
        if (evidenceHash == bytes32(0) || commitHash == bytes32(0)) revert InvalidHash();
        if (block.timestamp > attestationExpiry) revert AttestationExpired();

        bytes32 digest =
            receiptAttestationDigest(taskId, evidenceHash, commitHash, attestationExpiry);
        if (usedAttestations[digest]) revert AttestationAlreadyUsed();
        if (task.status != TaskStatus.Open) revert InvalidState();
        if (task.deadline != 0 && block.timestamp > task.deadline) revert DeadlinePassed();
        (address signer, ECDSA.RecoverError recoverError,) =
            ECDSA.tryRecover(digest, verifierSignature);
        if (recoverError != ECDSA.RecoverError.NoError || signer != verifier) {
            revert InvalidAttestation();
        }

        usedAttestations[digest] = true;
        task.evidenceHash = evidenceHash;
        task.commitHash = commitHash;
        task.status = TaskStatus.ReceiptSubmitted;

        emit VerifierAttestationConsumed(taskId, digest, verifier, attestationExpiry);
        emit ReceiptSubmitted(taskId, msg.sender, evidenceHash, commitHash);
    }

    /// @notice Computes the EIP-712 digest a verifier signs for a passing receipt.
    /// @dev The domain binds chain ID and this contract; the struct binds all task/evidence identity.
    function receiptAttestationDigest(
        uint256 taskId,
        bytes32 evidenceHash,
        bytes32 commitHash,
        uint64 attestationExpiry
    ) public view returns (bytes32 digest) {
        Task storage task = _task(taskId);
        bytes32 structHash = keccak256(
            abi.encode(
                PASSING_RECEIPT_TYPEHASH,
                taskId,
                task.taskHash,
                task.policyHash,
                task.assignee,
                evidenceHash,
                commitHash,
                attestationExpiry
            )
        );
        digest = _hashTypedDataV4(structHash);
    }

    /// @notice Approves the submitted receipt and credits its reward to the assignee.
    /// @param taskId Existing receipt-submitted task ID.
    function approveTask(uint256 taskId) external {
        Task storage task = _task(taskId);
        if (msg.sender != task.creator) revert Unauthorized();
        if (task.status != TaskStatus.ReceiptSubmitted) revert InvalidState();

        task.status = TaskStatus.Approved;
        uint256 reward = _creditReward(task, task.assignee, taskId);

        emit TaskApproved(taskId, task.assignee, reward);
    }

    /// @notice Terminally rejects a submitted receipt and refunds the creator by pull payment.
    /// @param taskId Existing receipt-submitted task ID.
    /// @param reasonHash Nonzero commitment to the offchain rejection reason.
    function rejectTask(uint256 taskId, bytes32 reasonHash) external {
        Task storage task = _task(taskId);
        if (msg.sender != task.creator) revert Unauthorized();
        if (task.status != TaskStatus.ReceiptSubmitted) revert InvalidState();
        if (reasonHash == bytes32(0)) revert InvalidHash();

        task.status = TaskStatus.Rejected;
        _creditReward(task, task.creator, taskId);

        emit TaskRejected(taskId, reasonHash);
    }

    /// @notice Cancels an open task and refunds its creator by pull payment.
    /// @param taskId Existing open task ID.
    function cancelTask(uint256 taskId) external {
        Task storage task = _task(taskId);
        if (msg.sender != task.creator) revert Unauthorized();
        if (task.status != TaskStatus.Open) revert InvalidState();

        task.status = TaskStatus.Cancelled;
        _creditReward(task, task.creator, taskId);

        emit TaskCancelled(taskId);
    }

    /// @notice Expires an open task after its nonzero deadline and refunds its creator by pull payment.
    /// @param taskId Existing open task ID.
    function expireTask(uint256 taskId) external {
        Task storage task = _task(taskId);
        if (task.status != TaskStatus.Open) revert InvalidState();
        if (task.deadline == 0 || block.timestamp <= task.deadline) revert DeadlineNotPassed();

        task.status = TaskStatus.Expired;
        _creditReward(task, task.creator, taskId);

        emit TaskExpired(taskId);
    }

    /// @notice Withdraws all native currency credited to the caller.
    /// @dev Credit is cleared before the only external call and restored automatically on revert.
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        withdrawable[msg.sender] = 0;
        totalWithdrawable -= amount;
        (bool success,) = payable(msg.sender).call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    function _task(uint256 taskId) private view returns (Task storage task) {
        task = tasks[taskId];
        if (task.status == TaskStatus.None) revert TaskNotFound();
    }

    function _creditReward(Task storage task, address account, uint256 taskId)
        private
        returns (uint256 amount)
    {
        amount = task.reward;
        task.reward = 0;
        if (amount != 0) {
            totalLockedRewards -= amount;
            withdrawable[account] += amount;
            totalWithdrawable += amount;
        }
        emit WithdrawalCredited(account, amount, taskId);
    }
}
