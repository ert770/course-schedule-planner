/**
 * Reserve one ID using the caller's open transaction connection.
 * The caller must insert User_Profiles in the same transaction and roll back the
 * entire transaction on any failure. On a Profile PRIMARY KEY collision only,
 * retry the entire transaction with a new allocation. Never retry other unique
 * violations as ID collisions. InnoDB auto-increment values can be skipped on
 * rollback or contention; they must not be reused or assumed contiguous.
 */
export const MIN_USER_ID = 5;
export const MAX_USER_ID = 8999;

export class UserIdRangeExhaustedError extends Error {
  constructor() {
    super('User ID allocation is outside the permitted range 5–8999');
    this.name = 'UserIdRangeExhaustedError';
    this.code = 'USER_ID_RANGE_EXHAUSTED';
  }
}

export async function allocateUserId(connection) {
  if (!connection || typeof connection.execute !== 'function') {
    throw new TypeError('An active transaction connection is required');
  }
  const [result] = await connection.execute('INSERT INTO `User_Id_Allocator` () VALUES ()');
  const id = Number(result?.insertId);
  if (!Number.isSafeInteger(id) || id < MIN_USER_ID || id > MAX_USER_ID) {
    throw new UserIdRangeExhaustedError();
  }
  return id;
}

/** The profile insert boundary raises this only for User_Profiles PRIMARY collisions. */
export class UserIdCollisionError extends Error {
  constructor(options = {}) {
    super('User_Profiles primary key collision', options);
    this.name = 'UserIdCollisionError';
    this.code = 'USER_ID_COLLISION';
  }
}

/** runTransaction must roll back on rejection and start a fresh transaction per call. */
export async function createWithAllocatedUserId(runTransaction, createProfile, { maxAttempts = 3 } = {}) {
  if (typeof runTransaction !== 'function' || typeof createProfile !== 'function'
      || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new TypeError('Invalid transaction callback, profile callback, or retry limit');
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await runTransaction(async connection => {
        const userId = await allocateUserId(connection);
        return createProfile(connection, userId);
      });
    } catch (error) {
      if (!(error instanceof UserIdCollisionError) || attempt === maxAttempts - 1) throw error;
    }
  }
}
