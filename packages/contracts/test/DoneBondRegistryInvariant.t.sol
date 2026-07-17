// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { DoneBondRegistry } from "../src/DoneBondRegistry.sol";

contract RegistryHandler is Test {
    uint256 internal constant VERIFIER_KEY = 0xA11CE;
    bytes32 internal constant EVIDENCE_HASH = keccak256("evidence");
    bytes32 internal constant COMMIT_HASH = keccak256("commit");
    bytes32 internal constant REASON_HASH = keccak256("reason");

    DoneBondRegistry public immutable registry;
    address[] internal actors;

    constructor(DoneBondRegistry registry_) {
        registry = registry_;
        actors.push(makeAddr("actor-0"));
        actors.push(makeAddr("actor-1"));
        actors.push(makeAddr("actor-2"));
        actors.push(makeAddr("actor-3"));
        for (uint256 i; i < actors.length; ++i) {
            vm.deal(actors[i], 1_000_000 ether);
        }
    }

    function create(uint256 creatorSeed, uint256 assigneeSeed, uint96 reward, uint32 ttl) external {
        address creator = actors[creatorSeed % actors.length];
        address assignee = actors[assigneeSeed % actors.length];
        reward = uint96(uint256(reward) % (100 ether + 1));
        vm.deal(creator, creator.balance + reward);
        uint64 deadline =
            ttl % 2 == 0 ? 0 : uint64(block.timestamp + bound(ttl, 1, type(uint32).max));
        vm.prank(creator);
        registry.createTask{ value: reward }(
            keccak256(abi.encode("task", registry.nextTaskId())),
            keccak256(abi.encode("policy", registry.nextTaskId())),
            assignee,
            deadline
        );
    }

    function submit(uint256 seed, uint32 ttl) external {
        uint256 taskId = _taskId(seed);
        (,, DoneBondRegistry.TaskStatus status, address assignee,,,,,) = registry.tasks(taskId);
        if (status != DoneBondRegistry.TaskStatus.Open) return;
        uint64 expiry = uint64(block.timestamp + bound(ttl, 0, type(uint32).max));
        bytes32 digest =
            registry.receiptAttestationDigest(taskId, EVIDENCE_HASH, COMMIT_HASH, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_KEY, digest);
        vm.prank(assignee);
        registry.submitReceipt(
            taskId, EVIDENCE_HASH, COMMIT_HASH, expiry, abi.encodePacked(r, s, v)
        );
    }

    function approve(uint256 seed) external {
        uint256 taskId = _taskId(seed);
        (address creator,, DoneBondRegistry.TaskStatus status,,,,,,) = registry.tasks(taskId);
        if (status != DoneBondRegistry.TaskStatus.ReceiptSubmitted) return;
        vm.prank(creator);
        registry.approveTask(taskId);
    }

    function reject(uint256 seed) external {
        uint256 taskId = _taskId(seed);
        (address creator,, DoneBondRegistry.TaskStatus status,,,,,,) = registry.tasks(taskId);
        if (status != DoneBondRegistry.TaskStatus.ReceiptSubmitted) return;
        vm.prank(creator);
        registry.rejectTask(taskId, REASON_HASH);
    }

    function cancel(uint256 seed) external {
        uint256 taskId = _taskId(seed);
        (address creator,, DoneBondRegistry.TaskStatus status,,,,,,) = registry.tasks(taskId);
        if (status != DoneBondRegistry.TaskStatus.Open) return;
        vm.prank(creator);
        registry.cancelTask(taskId);
    }

    function expire(uint256 seed, uint32 jump) external {
        uint256 taskId = _taskId(seed);
        (, uint64 deadline, DoneBondRegistry.TaskStatus status,,,,,,) = registry.tasks(taskId);
        if (status != DoneBondRegistry.TaskStatus.Open || deadline == 0) return;
        vm.warp(uint256(deadline) + bound(jump, 1, type(uint32).max));
        registry.expireTask(taskId);
    }

    function withdraw(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (registry.withdrawable(actor) == 0) return;
        vm.prank(actor);
        registry.withdraw();
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 index) external view returns (address) {
        return actors[index];
    }

    function _taskId(uint256 seed) private view returns (uint256) {
        uint256 count = registry.nextTaskId() - 1;
        if (count == 0) return 0;
        return (seed % count) + 1;
    }
}

contract DoneBondRegistryInvariantTest is StdInvariant, Test {
    DoneBondRegistry internal registry;
    RegistryHandler internal handler;

    function setUp() public {
        registry = new DoneBondRegistry(vm.addr(0xA11CE));
        handler = new RegistryHandler(registry);
        targetContract(address(handler));
    }

    function invariantContractIsExactlySolvent() public view {
        assertEq(
            address(registry).balance, registry.totalLockedRewards() + registry.totalWithdrawable()
        );
    }

    function invariantAggregateAccountingMatchesEveryTaskAndActor() public view {
        uint256 locked;
        for (uint256 taskId = 1; taskId < registry.nextTaskId(); ++taskId) {
            (,, DoneBondRegistry.TaskStatus status,, uint96 reward,,,,) = registry.tasks(taskId);
            if (
                status == DoneBondRegistry.TaskStatus.Open
                    || status == DoneBondRegistry.TaskStatus.ReceiptSubmitted
            ) {
                locked += reward;
            } else {
                assertEq(reward, 0, "terminal task retains reward");
            }
        }
        assertEq(locked, registry.totalLockedRewards(), "locked total diverged");

        uint256 credits;
        for (uint256 i; i < handler.actorCount(); ++i) {
            credits += registry.withdrawable(handler.actorAt(i));
        }
        assertEq(credits, registry.totalWithdrawable(), "withdrawable total diverged");
    }

    function invariantTerminalTasksCannotBeCreditedAgain() public view {
        for (uint256 taskId = 1; taskId < registry.nextTaskId(); ++taskId) {
            (,, DoneBondRegistry.TaskStatus status,, uint96 reward,,,,) = registry.tasks(taskId);
            if (uint8(status) >= uint8(DoneBondRegistry.TaskStatus.Approved)) {
                assertEq(reward, 0);
            }
        }
    }
}
