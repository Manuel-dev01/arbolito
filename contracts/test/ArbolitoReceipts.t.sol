// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArbolitoReceipts} from "../src/ArbolitoReceipts.sol";

contract ArbolitoReceiptsTest is Test {
    event ReceiptAnchored(bytes32 indexed bundleHash, bytes32 indexed routeId, address indexed emitter);

    ArbolitoReceipts internal receipts;
    address internal owner = makeAddr("owner");
    address internal sessionKey = makeAddr("sessionKey");
    address internal stranger = makeAddr("stranger");
    bytes32 internal constant HASH = keccak256("bundle");
    bytes32 internal constant ROUTE = bytes32(uint256(0xabc));

    function setUp() public {
        receipts = new ArbolitoReceipts(owner);
    }

    function test_ownerIsInitialEmitter() public view {
        assertEq(receipts.owner(), owner);
        assertTrue(receipts.isEmitter(owner));
    }

    function test_emitReceipt_emitsAndRecordsBlock() public {
        vm.roll(1234);
        vm.expectEmit(true, true, true, true);
        emit ReceiptAnchored(HASH, ROUTE, owner);
        vm.prank(owner);
        receipts.emitReceipt(HASH, ROUTE);
        assertEq(receipts.anchoredAt(HASH), 1234);
    }

    function test_emitReceipt_revertsForNonEmitter() public {
        vm.prank(stranger);
        vm.expectRevert(ArbolitoReceipts.NotEmitter.selector);
        receipts.emitReceipt(HASH, ROUTE);
    }

    function test_emitReceipt_revertsOnDuplicate() public {
        vm.startPrank(owner);
        receipts.emitReceipt(HASH, ROUTE);
        vm.expectRevert(abi.encodeWithSelector(ArbolitoReceipts.AlreadyAnchored.selector, HASH));
        receipts.emitReceipt(HASH, bytes32(uint256(0xdef)));
        vm.stopPrank();
    }

    function test_emitReceipt_revertsOnZeroHash() public {
        vm.prank(owner);
        vm.expectRevert(ArbolitoReceipts.ZeroHash.selector);
        receipts.emitReceipt(bytes32(0), ROUTE);
    }

    function test_setEmitter_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(ArbolitoReceipts.NotOwner.selector);
        receipts.setEmitter(sessionKey, true);

        vm.prank(owner);
        receipts.setEmitter(sessionKey, true);
        vm.prank(sessionKey);
        receipts.emitReceipt(HASH, ROUTE);
        assertEq(receipts.anchoredAt(HASH), block.number);

        vm.prank(owner);
        receipts.setEmitter(sessionKey, false);
        vm.prank(sessionKey);
        vm.expectRevert(ArbolitoReceipts.NotEmitter.selector);
        receipts.emitReceipt(keccak256("other"), ROUTE);
    }

    function test_transferOwnership() public {
        vm.prank(owner);
        receipts.transferOwnership(stranger);
        assertEq(receipts.owner(), stranger);
        vm.prank(owner);
        vm.expectRevert(ArbolitoReceipts.NotOwner.selector);
        receipts.setEmitter(sessionKey, true);
    }

    function test_rejectsZeroAddresses() public {
        vm.expectRevert(ArbolitoReceipts.ZeroAddress.selector);
        new ArbolitoReceipts(address(0));
        vm.prank(owner);
        vm.expectRevert(ArbolitoReceipts.ZeroAddress.selector);
        receipts.transferOwnership(address(0));
    }

    /// The ERC-8021 suffix is appended to deploy initcode too; the constructor must ignore it.
    function test_deployWithTrailingAttributionSuffix() public {
        bytes memory initcode = abi.encodePacked(
            type(ArbolitoReceipts).creationCode,
            abi.encode(owner),
            // toDataSuffix("arbolito_fork")
            hex"6172626f6c69746f5f666f726b0d0080218021802180218021802180218021"
        );
        address deployed;
        assembly {
            deployed := create(0, add(initcode, 0x20), mload(initcode))
        }
        assertTrue(deployed != address(0));
        assertEq(ArbolitoReceipts(deployed).owner(), owner);
    }

    function testFuzz_anyEmitterAnchorsOnce(bytes32 h, bytes32 r) public {
        vm.assume(h != bytes32(0));
        vm.startPrank(owner);
        receipts.emitReceipt(h, r);
        vm.expectRevert(abi.encodeWithSelector(ArbolitoReceipts.AlreadyAnchored.selector, h));
        receipts.emitReceipt(h, r);
        vm.stopPrank();
    }
}
