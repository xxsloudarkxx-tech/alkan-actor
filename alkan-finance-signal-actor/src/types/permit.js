/**
 * permit.js — JSDoc type definitions for the stable normalized permit record.
 *
 * Plain JS + JSDoc (the repo does not use TypeScript). These typedefs document
 * the contract and give editors/`node --check` useful hints without a build step.
 */

export const SCHEMA_VERSION = '1.0';

/**
 * @typedef {Object} NormalizedAddress
 * @property {string|null} line1
 * @property {string} city
 * @property {string} state
 * @property {string|null} postalCode
 * @property {number|null} latitude
 * @property {number|null} longitude
 */

/**
 * A single public contact. Roles are kept strictly separate — see contacts.js.
 * @typedef {Object} PublicContact
 * @property {string} role            Exact displayed role, or "unknown_public_contact".
 * @property {string} source          System the contact came from.
 * @property {string} retrievedAt     ISO-8601 retrieval timestamp.
 * @property {number} confidence      0..1 deterministic confidence.
 * @property {('organizational'|'personal'|'unknown')} contactType
 * @property {string|null} [name]     Present only when includeContacts=true.
 * @property {string|null} [phone]    Present only when includeContacts=true.
 * @property {string|null} [email]    Present only when includeContacts=true.
 */

/**
 * @typedef {Object} NormalizedEntities
 * @property {string|null} applicantName
 * @property {string|null} applicantOrganization
 * @property {string|null} contractorName
 * @property {string|null} contractorLicense
 * @property {string|null} ownerName
 * @property {string|null} financiallyResponsibleParty
 */

/**
 * @typedef {Object} NormalizedPermit
 * @property {string} schemaVersion
 * @property {Object} source
 * @property {Object} permit
 * @property {NormalizedEntities} entities
 * @property {PublicContact[]} contacts
 * @property {Object[]} evidence
 * @property {Object} dataQuality
 */

export {};
