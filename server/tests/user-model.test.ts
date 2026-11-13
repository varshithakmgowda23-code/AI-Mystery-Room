import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/db/models/User.js';

describe('User schema', () => {
  it('expires guest accounts after their guest expiry timestamp', () => {
    const guestExpiryIndex = UserModel.schema.indexes().find(([fields, options]) =>
      'guestExpiresAt' in fields && options?.expireAfterSeconds === 0,
    );
    expect(guestExpiryIndex).toBeDefined();
    expect(guestExpiryIndex?.[1].partialFilterExpression).toEqual({ isGuest: true });
  });
});
