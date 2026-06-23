import { createHmac } from 'node:crypto';
import {
  candidateMessages,
  verifyFreshbooksSignature,
} from './webhook-signature';

const verifier = 'scADVVi5QuKuj5qTjVkbJNYQe7V7USpGd';
const fields = {
  name: 'invoice.update',
  object_id: '1343805',
  account_id: 'wky7J4',
};

function sign(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('base64');
}

describe('candidateMessages', () => {
  it('produces the Python json.dumps spacing variant', () => {
    const msgs = candidateMessages(fields);
    expect(msgs).toContain(
      '{"name": "invoice.update", "object_id": "1343805", "account_id": "wky7J4"}',
    );
  });

  it('includes the raw body when provided', () => {
    const raw = 'name=invoice.update&object_id=1343805';
    expect(candidateMessages(fields, raw)).toContain(raw);
  });
});

describe('verifyFreshbooksSignature', () => {
  it('accepts a signature over the python-json serialization', () => {
    const sig = sign(
      verifier,
      '{"name": "invoice.update", "object_id": "1343805", "account_id": "wky7J4"}',
    );
    expect(verifyFreshbooksSignature([verifier], fields, sig)).toBe(true);
  });

  it('accepts a signature over the raw body', () => {
    const raw = 'name=invoice.update&object_id=1343805&account_id=wky7J4';
    const sig = sign(verifier, raw);
    expect(verifyFreshbooksSignature([verifier], fields, sig, raw)).toBe(true);
  });

  it('tries multiple verifiers and matches the right one', () => {
    const sig = sign(verifier, candidateMessages(fields)[0]);
    expect(
      verifyFreshbooksSignature(['wrong-key', verifier], fields, sig),
    ).toBe(true);
  });

  it('rejects a bad signature', () => {
    expect(
      verifyFreshbooksSignature([verifier], fields, 'definitely-not-valid'),
    ).toBe(false);
  });

  it('rejects when no verifiers or no header', () => {
    expect(verifyFreshbooksSignature([], fields, 'x')).toBe(false);
    expect(verifyFreshbooksSignature([verifier], fields, undefined)).toBe(
      false,
    );
  });
});
