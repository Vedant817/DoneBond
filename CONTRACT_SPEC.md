# Smart Contract Specification

## Contract

`DoneBondRegistry.sol`

## Purpose

Store compact task and receipt commitments on Monad, enforce lifecycle permissions, hold optional native-MON rewards, and provide safe pull-payment settlement.

## Recommended dependencies

Use well-audited OpenZeppelin components where appropriate:

- `ReentrancyGuard`
- `Pausable` only if an operational pause is genuinely needed
- `Ownable2Step` only for protocol-level administration, not task ownership

Avoid upgradeability in the hackathon MVP. A small immutable contract is easier to audit, explain, and verify.

## Data model

```solidity
uint256 public nextTaskId;

enum TaskStatus {
    None,
    Open,
    ReceiptSubmitted,
    Approved,
    Rejected,
    Cancelled,
    Expired
}

struct Task {
    address creator;
    address assignee;
    bytes32 taskHash;
    bytes32 policyHash;
    bytes32 evidenceHash;
    bytes32 commitHash;
    uint96 reward;
    uint64 deadline;
    TaskStatus status;
}

mapping(uint256 => Task) public tasks;
mapping(address => uint256) public withdrawable;
```

Review storage packing rather than assuming this exact order is optimal. Use a reward type that safely supports the intended range and validate casting.

## External functions

### `createTask`

```solidity
function createTask(
    bytes32 taskHash,
    bytes32 policyHash,
    address assignee,
    uint64 deadline
) external payable returns (uint256 taskId);
```

Requirements:

- nonzero task and policy hashes;
- assignee may be zero only when open claims are deliberately supported; otherwise require nonzero;
- deadline is zero for no deadline or is greater than current timestamp;
- `msg.value` becomes the reward;
- emits all information needed for indexing.

### `submitReceipt`

```solidity
function submitReceipt(
    uint256 taskId,
    bytes32 evidenceHash,
    bytes32 commitHash
) external;
```

Requirements:

- task exists and is open;
- caller equals assignee;
- deadline has not passed;
- hashes are nonzero;
- receipt can be submitted only once in the MVP;
- changes state before emitting.

The contract cannot prove tests passed. It proves which evidence commitment the assignee submitted. The offchain verifier and creator review establish the meaning of the bundle.

### `approveTask`

```solidity
function approveTask(uint256 taskId) external;
```

Requirements:

- caller is creator;
- status is `ReceiptSubmitted`;
- changes status to approved;
- sets task reward to zero before crediting or otherwise prevents double accounting;
- credits `withdrawable[assignee]` exactly once;
- emits approval and credited amount.

### `rejectTask`

```solidity
function rejectTask(uint256 taskId, bytes32 reasonHash) external;
```

For the MVP, decide one of two explicit semantics:

1. rejection is terminal and creator can reclaim reward; or
2. rejection allows resubmission through a new task/version.

Prefer terminal rejection plus a new task version because it keeps the state machine simple and auditable.

### `cancelTask`

Creator may cancel only while open and before a receipt exists. Reward is credited to creator’s withdrawable balance rather than pushed during the state transition.

### `expireTask`

After a nonzero deadline passes, creator or any caller may transition an eligible open task to expired. Reward is credited back to creator.

### `withdraw`

```solidity
function withdraw() external nonReentrant;
```

Requirements:

- amount is nonzero;
- set balance to zero before external call;
- use `call` and revert safely if transfer fails;
- restoring credit on failure happens automatically through revert;
- emit withdrawn amount.

## Events

```solidity
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
    uint256 indexed taskId,
    address indexed assignee,
    bytes32 evidenceHash,
    bytes32 commitHash
);

event TaskApproved(uint256 indexed taskId, address indexed assignee, uint256 reward);
event TaskRejected(uint256 indexed taskId, bytes32 reasonHash);
event TaskCancelled(uint256 indexed taskId);
event TaskExpired(uint256 indexed taskId);
event WithdrawalCredited(address indexed account, uint256 amount, uint256 indexed taskId);
event Withdrawn(address indexed account, uint256 amount);
```

## Custom errors

Use custom errors for gas efficiency and clarity:

- `TaskNotFound()`
- `Unauthorized()`
- `InvalidState()`
- `InvalidHash()`
- `InvalidDeadline()`
- `DeadlinePassed()`
- `DeadlineNotPassed()`
- `NothingToWithdraw()`
- `TransferFailed()`
- `ValueTooLarge()`

## State transitions

```text
None -> Open
Open -> ReceiptSubmitted
Open -> Cancelled
Open -> Expired
ReceiptSubmitted -> Approved
ReceiptSubmitted -> Rejected
```

No transition leaves a terminal state.

## Invariants

- A task’s funded reward is credited at most once.
- An approved task cannot be approved, rejected, cancelled, or expired again.
- Contract balance is always at least total withdrawable credits plus rewards still locked in active tasks.
- A withdrawal cannot transfer more than the caller’s credit.
- Only the configured assignee can submit a receipt.
- Only the creator can approve, reject, or cancel.
- Hash commitments are immutable after their corresponding transition.
- Every value-moving state transition emits an event.

## Test plan

### Unit tests

Cover every successful transition and every revert path, including zero hashes, wrong caller, duplicate submission, duplicate approval, deadline boundaries, cancellation after receipt, and failed receiver withdrawal.

### Fuzz tests

Fuzz rewards, timestamps, task IDs, callers, and hash values. Assert no unauthorized state transition and no accounting mismatch.

### Invariant tests

Use a handler that creates, submits, approves, rejects, cancels, expires, and withdraws across many actors. Track expected locked and credited balances independently.

### Adversarial receiver

Test a receiver contract that reenters and another that rejects MON transfers.

## Deployment

- Deploy to Monad Testnet first.
- Verify source code in a supported explorer.
- Persist chain ID, address, deployment transaction, compiler version, optimizer settings, and ABI.
- Never commit the deployer private key.
- Use a dedicated low-balance deployment wallet.
