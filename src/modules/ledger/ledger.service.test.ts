import { createHash } from 'crypto';

describe('hash ledger chain integrity', () => {
  function chainHash(prev: string | null, sha: string): string {
    return createHash('sha256')
      .update(prev ?? '')
      .update('|')
      .update(sha)
      .digest('hex');
  }

  it('chains hashes so altering any node invalidates downstream', () => {
    const sha1 = 'aa'.repeat(32);
    const sha2 = 'bb'.repeat(32);
    const sha3 = 'cc'.repeat(32);

    const c1 = chainHash(null, sha1);
    const c2 = chainHash(c1, sha2);
    const c3 = chainHash(c2, sha3);

    // Recomputing with an attacker's altered sha2 produces a different chain
    const tampered = chainHash(c1, 'dd'.repeat(32));
    expect(tampered).not.toEqual(c2);

    // And the original c3 cannot be reproduced after tampering
    const c3IfTampered = chainHash(tampered, sha3);
    expect(c3IfTampered).not.toEqual(c3);
  });

  it('uses prev separator | so prefix-attacks are not possible', () => {
    const a = chainHash(null, 'a');
    const b = chainHash(a, 'b');
    const ab = chainHash(null, 'a|b');
    expect(b).not.toEqual(ab);
  });
});
