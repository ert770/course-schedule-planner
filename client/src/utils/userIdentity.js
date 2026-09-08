export function getUserIdentity(user) {
  return user?.studentId ?? user?.id ?? null;
}
