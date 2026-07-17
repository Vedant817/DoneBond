// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { DoneBondRegistry } from "../src/DoneBondRegistry.sol";

contract DoneBondRegistryTest is Test {
    DoneBondRegistry internal registry;

    uint256 internal constant VERIFIER_KEY = 0xA11CE;
    address internal verifier;
    address internal creator = makeAddr("creator");
    address internal assignee = makeAddr("assignee");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant TASK_HASH = keccak256("task");
    bytes32 internal constant POLICY_HASH = keccak256("policy");
    bytes32 internal constant EVIDENCE_HASH = keccak256("evidence");
    bytes32 internal constant COMMIT_HASH = keccak256("commit");
    bytes32 internal constant REASON_HASH = keccak256("reason");
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

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

    function setUp() public {
        verifier = vm.addr(VERIFIER_KEY);
        registry = new DoneBondRegistry(verifier);
        vm.deal(creator, type(uint128).max);
    }

    function testConstructorRejectsZeroVerifier() public {
        vm.expectRevert(DoneBondRegistry.InvalidVerifier.selector);
        new DoneBondRegistry(address(0));
    }

    function testConstructorRejectsContractVerifier() public {
        vm.expectRevert(DoneBondRegistry.InvalidVerifier.selector);
        new DoneBondRegistry(address(this));
    }

    function testSharedEip712FixedVector() public {
        vm.chainId(10_143);
        address targetAddress = 0x1212121212121212121212121212121212121212;
        vm.etch(targetAddress, address(registry).code);
        DoneBondRegistry target = DoneBondRegistry(targetAddress);
        address vectorAssignee = 0x3434343434343434343434343434343434343434;

        target.createTask(keccak256("unused task"), keccak256("unused policy"), vectorAssignee, 0);
        uint256 taskId = target.createTask(
            bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111)),
            bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222)),
            vectorAssignee,
            0
        );

        assertEq(taskId, 1);
        assertEq(
            target.PASSING_RECEIPT_TYPEHASH(),
            0x59d552f1cf676b302e799cde1beeb4544365adc2c515c19ced9e43da442e29ff
        );
        assertEq(
            target.receiptAttestationDigest(
                taskId,
                bytes32(
                    uint256(0x4444444444444444444444444444444444444444444444444444444444444444)
                ),
                bytes32(
                        uint256(0x5555555555555555555555555555555555555555555555555555555555555555)
                    ),
                1_784_246_400
            ),
            0xc3195344fe8ff265b688cbfc6dadcf403a0de25d776fe9e56d38be4496d56a59
        );
    }

    function testCreateTaskStoresPackedCommitmentsAndEmits() public {
        uint64 deadline = uint64(block.timestamp + 1 days);
        vm.expectEmit(true, true, true, true, address(registry));
        emit TaskCreated(1, creator, assignee, TASK_HASH, POLICY_HASH, 2 ether, deadline);
        uint256 taskId = _create(2 ether, deadline);

        (
            address storedCreator,
            uint64 storedDeadline,
            DoneBondRegistry.TaskStatus status,
            address storedAssignee,
            uint96 reward,
            bytes32 taskHash,
            bytes32 policyHash,
            bytes32 evidenceHash,
            bytes32 commitHash
        ) = registry.tasks(taskId);
        assertEq(storedCreator, creator);
        assertEq(storedDeadline, deadline);
        assertEq(uint8(status), uint8(DoneBondRegistry.TaskStatus.Open));
        assertEq(storedAssignee, assignee);
        assertEq(reward, 2 ether);
        assertEq(taskHash, TASK_HASH);
        assertEq(policyHash, POLICY_HASH);
        assertEq(evidenceHash, bytes32(0));
        assertEq(commitHash, bytes32(0));
        assertEq(registry.totalLockedRewards(), 2 ether);
        assertEq(registry.nextTaskId(), 2);
    }

    function testCreateTaskAllowsZeroRewardAndNoDeadline() public {
        uint256 taskId = _create(0, 0);
        assertEq(_reward(taskId), 0);
        assertEq(uint8(_status(taskId)), uint8(DoneBondRegistry.TaskStatus.Open));
    }

    function testCreateTaskRejectsInvalidInputs() public {
        vm.startPrank(creator);
        vm.expectRevert(DoneBondRegistry.InvalidHash.selector);
        registry.createTask(bytes32(0), POLICY_HASH, assignee, 0);
        vm.expectRevert(DoneBondRegistry.InvalidHash.selector);
        registry.createTask(TASK_HASH, bytes32(0), assignee, 0);
        vm.expectRevert(DoneBondRegistry.InvalidAssignee.selector);
        registry.createTask(TASK_HASH, POLICY_HASH, address(0), 0);
        vm.expectRevert(DoneBondRegistry.InvalidDeadline.selector);
        registry.createTask(TASK_HASH, POLICY_HASH, assignee, uint64(block.timestamp));
        vm.stopPrank();
    }

    function testCreateTaskRejectsRewardAboveUint96() public {
        uint256 excessive = uint256(type(uint96).max) + 1;
        vm.deal(creator, excessive);
        vm.prank(creator);
        vm.expectRevert(DoneBondRegistry.ValueTooLarge.selector);
        registry.createTask{ value: excessive }(TASK_HASH, POLICY_HASH, assignee, 0);
    }

    function testSubmitReceiptRequiresPassingVerifierAttestation() public {
        uint256 taskId = _create(1 ether, 0);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory signature = _signature(registry, taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);

        vm.expectEmit(true, true, false, true, address(registry));
        emit ReceiptSubmitted(taskId, assignee, EVIDENCE_HASH, COMMIT_HASH);
        vm.prank(assignee);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);

        assertEq(uint8(_status(taskId)), uint8(DoneBondRegistry.TaskStatus.ReceiptSubmitted));
        (,,,,,,, bytes32 storedEvidence, bytes32 storedCommit) = registry.tasks(taskId);
        assertEq(storedEvidence, EVIDENCE_HASH);
        assertEq(storedCommit, COMMIT_HASH);
        assertTrue(
            registry.usedAttestations(
                registry.receiptAttestationDigest(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry)
            )
        );
    }

    function testSubmitReceiptRejectsWrongCallerAndMissingTask() public {
        uint256 taskId = _create(0, 0);
        uint64 expiry = uint64(block.timestamp + 1);
        bytes memory signature = _signature(registry, taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.prank(stranger);
        vm.expectRevert(DoneBondRegistry.Unauthorized.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);

        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.TaskNotFound.selector);
        registry.submitReceipt(999, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
    }

    function testSubmitReceiptRejectsInvalidHashesAndMalformedSignature() public {
        uint256 taskId = _create(0, 0);
        uint64 expiry = uint64(block.timestamp + 1);
        vm.startPrank(assignee);
        vm.expectRevert(DoneBondRegistry.InvalidHash.selector);
        registry.submitReceipt(taskId, bytes32(0), COMMIT_HASH, expiry, "");
        vm.expectRevert(DoneBondRegistry.InvalidHash.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, bytes32(0), expiry, "");
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, hex"1234");
        vm.stopPrank();
    }

    function testSubmitReceiptDeadlineBoundaryAndExpiry() public {
        uint64 deadline = uint64(block.timestamp + 10);
        uint256 atBoundary = _create(0, deadline);
        vm.warp(deadline);
        uint64 expiry = deadline + 10;
        bytes memory signature =
            _signature(registry, atBoundary, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.prank(assignee);
        registry.submitReceipt(atBoundary, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);

        uint256 passed = _create(0, uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 2);
        expiry = uint64(block.timestamp + 10);
        signature = _signature(registry, passed, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.DeadlinePassed.selector);
        registry.submitReceipt(passed, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
    }

    function testAttestationExpiryBoundaryAndPassedExpiry() public {
        uint256 taskId = _create(0, 0);
        uint64 expiry = uint64(block.timestamp);
        bytes memory signature = _signature(registry, taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.prank(assignee);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);

        taskId = _create(0, 0);
        expiry = uint64(block.timestamp + 1);
        signature = _signature(registry, taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.warp(expiry + 1);
        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.AttestationExpired.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
    }

    function testAttestationRejectsWrongSignerAndAlteredBoundFields() public {
        uint256 taskId = _create(0, 0);
        uint64 expiry = uint64(block.timestamp + 100);
        bytes32 digest =
            registry.receiptAttestationDigest(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest);
        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(
            taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, abi.encodePacked(r, s, v)
        );

        bytes memory valid = _signature(registry, taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.startPrank(assignee);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, keccak256("altered evidence"), COMMIT_HASH, expiry, valid);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, keccak256("altered commit"), expiry, valid);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry + 1, valid);
        vm.stopPrank();
    }

    function testAttestationRejectsAlteredTaskPolicyAssigneeAndTaskId() public {
        uint256 taskId = _create(0, 0);
        uint64 expiry = uint64(block.timestamp + 100);

        bytes memory alteredTaskId = _signatureForFields(
            registry,
            taskId + 1,
            TASK_HASH,
            POLICY_HASH,
            assignee,
            EVIDENCE_HASH,
            COMMIT_HASH,
            expiry
        );
        bytes memory alteredTaskHash = _signatureForFields(
            registry,
            taskId,
            keccak256("altered task"),
            POLICY_HASH,
            assignee,
            EVIDENCE_HASH,
            COMMIT_HASH,
            expiry
        );
        bytes memory alteredPolicyHash = _signatureForFields(
            registry,
            taskId,
            TASK_HASH,
            keccak256("altered policy"),
            assignee,
            EVIDENCE_HASH,
            COMMIT_HASH,
            expiry
        );
        bytes memory alteredAssignee = _signatureForFields(
            registry, taskId, TASK_HASH, POLICY_HASH, stranger, EVIDENCE_HASH, COMMIT_HASH, expiry
        );

        vm.startPrank(assignee);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, alteredTaskId);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, alteredTaskHash);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, alteredPolicyHash);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, alteredAssignee);
        vm.stopPrank();
    }

    function testAttestationRejectsDifferentChainDomain() public {
        uint256 taskId = _create(0, 0);
        uint64 expiry = uint64(block.timestamp + 100);
        bytes memory signature = _signature(registry, taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.chainId(block.chainid + 1);
        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
    }

    function testAttestationCannotReplayOrCrossTaskOrContract() public {
        uint256 first = _create(0, 0);
        uint256 second = _create(0, 0);
        uint64 expiry = uint64(block.timestamp + 100);
        bytes memory signature = _signature(registry, first, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.prank(assignee);
        registry.submitReceipt(first, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.AttestationAlreadyUsed.selector);
        registry.submitReceipt(first, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        registry.submitReceipt(second, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);

        DoneBondRegistry other = new DoneBondRegistry(verifier);
        vm.prank(creator);
        uint256 otherTask = other.createTask(TASK_HASH, POLICY_HASH, assignee, 0);
        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.InvalidAttestation.selector);
        other.submitReceipt(otherTask, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
    }

    function testApproveCreditsAssigneeExactlyOnceAndIsTerminal() public {
        uint256 taskId = _submitted(3 ether);
        vm.expectEmit(true, true, true, true, address(registry));
        emit WithdrawalCredited(assignee, 3 ether, taskId);
        vm.expectEmit(true, true, false, true, address(registry));
        emit TaskApproved(taskId, assignee, 3 ether);
        vm.prank(creator);
        registry.approveTask(taskId);
        assertEq(registry.withdrawable(assignee), 3 ether);
        assertEq(registry.totalLockedRewards(), 0);
        assertEq(registry.totalWithdrawable(), 3 ether);
        assertEq(_reward(taskId), 0);

        vm.prank(creator);
        vm.expectRevert(DoneBondRegistry.InvalidState.selector);
        registry.approveTask(taskId);
        vm.prank(creator);
        vm.expectRevert(DoneBondRegistry.InvalidState.selector);
        registry.rejectTask(taskId, REASON_HASH);
        vm.prank(creator);
        vm.expectRevert(DoneBondRegistry.InvalidState.selector);
        registry.cancelTask(taskId);
        vm.expectRevert(DoneBondRegistry.InvalidState.selector);
        registry.expireTask(taskId);
    }

    function testApproveRejectCancelRequireCreatorAndCorrectState() public {
        uint256 openId = _create(0, 0);
        vm.prank(stranger);
        vm.expectRevert(DoneBondRegistry.Unauthorized.selector);
        registry.cancelTask(openId);
        vm.prank(creator);
        vm.expectRevert(DoneBondRegistry.InvalidState.selector);
        registry.approveTask(openId);

        uint256 submittedId = _submitted(0);
        vm.prank(stranger);
        vm.expectRevert(DoneBondRegistry.Unauthorized.selector);
        registry.approveTask(submittedId);
        vm.prank(stranger);
        vm.expectRevert(DoneBondRegistry.Unauthorized.selector);
        registry.rejectTask(submittedId, REASON_HASH);
        vm.prank(creator);
        vm.expectRevert(DoneBondRegistry.InvalidHash.selector);
        registry.rejectTask(submittedId, bytes32(0));
        vm.prank(creator);
        vm.expectRevert(DoneBondRegistry.InvalidState.selector);
        registry.cancelTask(submittedId);
    }

    function testRejectIsTerminalAndRefundsCreator() public {
        uint256 taskId = _submitted(2 ether);
        vm.expectEmit(true, true, true, true, address(registry));
        emit WithdrawalCredited(creator, 2 ether, taskId);
        vm.expectEmit(true, false, false, true, address(registry));
        emit TaskRejected(taskId, REASON_HASH);
        vm.prank(creator);
        registry.rejectTask(taskId, REASON_HASH);
        assertEq(uint8(_status(taskId)), uint8(DoneBondRegistry.TaskStatus.Rejected));
        assertEq(_reward(taskId), 0);
        assertEq(registry.withdrawable(creator), 2 ether);
    }

    function testCancelRefundsCreatorAndIsTerminal() public {
        uint256 taskId = _create(2 ether, 0);
        vm.expectEmit(true, false, false, true, address(registry));
        emit TaskCancelled(taskId);
        vm.prank(creator);
        registry.cancelTask(taskId);
        assertEq(uint8(_status(taskId)), uint8(DoneBondRegistry.TaskStatus.Cancelled));
        assertEq(registry.withdrawable(creator), 2 ether);
        vm.prank(creator);
        vm.expectRevert(DoneBondRegistry.InvalidState.selector);
        registry.cancelTask(taskId);
    }

    function testExpireRequiresPassedNonzeroDeadlineAndAllowsAnyCaller() public {
        uint256 noDeadline = _create(0, 0);
        vm.expectRevert(DoneBondRegistry.DeadlineNotPassed.selector);
        registry.expireTask(noDeadline);

        uint64 deadline = uint64(block.timestamp + 10);
        uint256 taskId = _create(1 ether, deadline);
        vm.warp(deadline);
        vm.expectRevert(DoneBondRegistry.DeadlineNotPassed.selector);
        registry.expireTask(taskId);
        vm.warp(deadline + 1);
        vm.prank(stranger);
        registry.expireTask(taskId);
        assertEq(uint8(_status(taskId)), uint8(DoneBondRegistry.TaskStatus.Expired));
        assertEq(registry.withdrawable(creator), 1 ether);
    }

    function testWithdrawUsesChecksEffectsInteractions() public {
        uint256 taskId = _submitted(2 ether);
        vm.prank(creator);
        registry.approveTask(taskId);
        uint256 beforeBalance = assignee.balance;
        vm.expectEmit(true, false, false, true, address(registry));
        emit Withdrawn(assignee, 2 ether);
        vm.prank(assignee);
        registry.withdraw();
        assertEq(assignee.balance, beforeBalance + 2 ether);
        assertEq(registry.withdrawable(assignee), 0);
        assertEq(registry.totalWithdrawable(), 0);
        vm.prank(assignee);
        vm.expectRevert(DoneBondRegistry.NothingToWithdraw.selector);
        registry.withdraw();
    }

    function testFuzzRewardAccounting(uint96 reward) public {
        vm.deal(creator, reward);
        uint256 taskId = _create(reward, 0);
        assertEq(registry.totalLockedRewards(), reward);
        taskId;
        vm.prank(creator);
        registry.cancelTask(taskId);
        assertEq(registry.totalLockedRewards(), 0);
        assertEq(registry.totalWithdrawable(), reward);
        assertEq(registry.withdrawable(creator), reward);
    }

    function testFuzzOnlyAssigneeCanSubmit(address caller) public {
        vm.assume(caller != assignee);
        uint256 taskId = _create(0, 0);
        uint64 expiry = uint64(block.timestamp + 1);
        bytes memory signature = _signature(registry, taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.prank(caller);
        vm.expectRevert(DoneBondRegistry.Unauthorized.selector);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
    }

    function testFuzzValidAttestation(bytes32 evidenceHash, bytes32 commitHash, uint32 ttl) public {
        vm.assume(evidenceHash != bytes32(0) && commitHash != bytes32(0));
        ttl = uint32(bound(ttl, 0, type(uint32).max));
        uint64 expiry = uint64(block.timestamp + ttl);
        uint256 taskId = _create(0, 0);
        bytes memory signature = _signature(registry, taskId, evidenceHash, commitHash, expiry);
        vm.prank(assignee);
        registry.submitReceipt(taskId, evidenceHash, commitHash, expiry, signature);
        assertEq(uint8(_status(taskId)), uint8(DoneBondRegistry.TaskStatus.ReceiptSubmitted));
    }

    function _create(uint256 reward, uint64 deadline) internal returns (uint256 taskId) {
        vm.prank(creator);
        taskId = registry.createTask{ value: reward }(TASK_HASH, POLICY_HASH, assignee, deadline);
    }

    function _submitted(uint256 reward) internal returns (uint256 taskId) {
        taskId = _create(reward, 0);
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes memory signature = _signature(registry, taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        vm.prank(assignee);
        registry.submitReceipt(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, signature);
    }

    function _signature(
        DoneBondRegistry target,
        uint256 taskId,
        bytes32 evidenceHash,
        bytes32 commitHash,
        uint64 expiry
    ) internal view returns (bytes memory) {
        bytes32 digest = target.receiptAttestationDigest(taskId, evidenceHash, commitHash, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signatureForFields(
        DoneBondRegistry target,
        uint256 taskId,
        bytes32 taskHash,
        bytes32 policyHash,
        address boundAssignee,
        bytes32 evidenceHash,
        bytes32 commitHash,
        uint64 expiry
    ) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("DoneBondRegistry"),
                keccak256("1"),
                block.chainid,
                address(target)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                target.PASSING_RECEIPT_TYPEHASH(),
                taskId,
                taskHash,
                policyHash,
                boundAssignee,
                evidenceHash,
                commitHash,
                expiry
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _status(uint256 taskId) internal view returns (DoneBondRegistry.TaskStatus status) {
        (,, status,,,,,,) = registry.tasks(taskId);
    }

    function _reward(uint256 taskId) internal view returns (uint96 reward) {
        (,,,, reward,,,,) = registry.tasks(taskId);
    }
}
