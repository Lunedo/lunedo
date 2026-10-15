export function peopleWithoutAccess<T extends { active: boolean; canRead: boolean }>(
  people: readonly T[],
): T[] {
  return people.filter((person) => person.active && !person.canRead);
}
