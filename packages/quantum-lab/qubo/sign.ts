import { KeyObject, sign, verify } from 'crypto';
import { QuboArtifact } from './types';

/** Optional compiler signature over payload_hash (Ed25519). Returns a new object; never mutates. */
export function signArtifact(artifact: QuboArtifact, keyId: string, privateKey: KeyObject): QuboArtifact {
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Artifact signing key must be Ed25519.');
  const signature = sign(null, Buffer.from(artifact.payload_hash, 'utf8'), privateKey).toString('base64');
  return { ...artifact, signature_key_id: keyId, signature };
}

export function verifyArtifactSignature(artifact: QuboArtifact, publicKey: KeyObject): boolean {
  if (!artifact.signature) return false;
  return verify(null, Buffer.from(artifact.payload_hash, 'utf8'), publicKey, Buffer.from(artifact.signature, 'base64'));
}
