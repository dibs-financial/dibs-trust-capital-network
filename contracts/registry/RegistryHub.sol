// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Registry Layer
// Entity, Asset, Policy, SPV, and Compliance Registries
pragma solidity ^0.8.24;

/**
 * @title RegistryHub
 * @dev Central registry hub for all DIBS system entities.
 *
 *      Registries:
 *      - Entity Registry
 *      - Investor Eligibility Registry
 *      - Asset Registry
 *      - Policy Registry
 *      - SPV Registry
 *      - Compliance Registry
 *      - Authorized Signer Registry
 *      - Oracle Registry
 *      - Strategy Adapter Registry
 */
contract RegistryHub {
    // Entity registry: entityId => entity data hash
    mapping(bytes32 => bytes32) public entities;

    // Investor eligibility: investorAddress => eligible
    mapping(address => bool) public investorEligibility;

    // Asset registry: assetId => asset data hash
    mapping(bytes32 => bytes32) public assets;

    // Policy registry: policyId => policy data hash
    mapping(bytes32 => bytes32) public policies;

    // SPV registry: spvId => SPV data hash
    mapping(bytes32 => bytes32) public spvs;

    // Compliance registry: entityId => compliance status
    mapping(bytes32 => uint8) public complianceStatus; // 0=unknown, 1=verified, 2=flagged, 3=blocked

    // Authorized signer registry: signerAddress => entityId
    mapping(address => bytes32) public authorizedSigners;

    // Oracle registry: oracleAddress => active
    mapping(address => bool) public oracles;

    // Strategy adapter registry: adapterAddress => active
    mapping(address => bool) public strategyAdapters;

    // TODO: Full CRUD for each registry
    // TODO: Versioned entries with historical state preservation
    // TODO: Role-based access control for registry mutations
    // TODO: Immutable event logging for all registry changes
}
