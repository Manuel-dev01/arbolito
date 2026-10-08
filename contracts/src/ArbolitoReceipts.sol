// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ArbolitoReceipts
/// @notice Anchors the keccak256 hash of each route's ProofBundle (canonical JSON) onchain.
///         Anyone can recompute the hash from the published JSON and find it here.
///         Holds no funds and is not upgradeable.
contract ArbolitoReceipts {
    address public owner;
    mapping(address emitter => bool allowed) public isEmitter;
    /// @notice Block number at which a bundle hash was anchored (0 = never).
    mapping(bytes32 bundleHash => uint256 blockNumber) public anchoredAt;

    event ReceiptAnchored(bytes32 indexed bundleHash, bytes32 indexed routeId, address indexed emitter);
    event EmitterSet(address indexed emitter, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotEmitter();
    error ZeroHash();
    error ZeroAddress();
    error AlreadyAnchored(bytes32 bundleHash);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        isEmitter[initialOwner] = true;
        emit OwnershipTransferred(address(0), initialOwner);
        emit EmitterSet(initialOwner, true);
    }

    /// @notice Anchor a ProofBundle hash. Each hash can be anchored once.
    function emitReceipt(bytes32 bundleHash, bytes32 routeId) external {
        if (!isEmitter[msg.sender]) revert NotEmitter();
        if (bundleHash == bytes32(0)) revert ZeroHash();
        if (anchoredAt[bundleHash] != 0) revert AlreadyAnchored(bundleHash);
        anchoredAt[bundleHash] = block.number;
        emit ReceiptAnchored(bundleHash, routeId, msg.sender);
    }

    /// @notice Allow or revoke an emitter (e.g. a scoped session key in Phase 2).
    function setEmitter(address emitter, bool allowed) external onlyOwner {
        if (emitter == address(0)) revert ZeroAddress();
        isEmitter[emitter] = allowed;
        emit EmitterSet(emitter, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
