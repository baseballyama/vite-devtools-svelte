export interface User {
  id: number;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  bio: string;
}

export async function fetchUsers(fetch: typeof globalThis.fetch): Promise<User[]> {
  const res = await fetch('/data/users.json');
  return (await res.json()) as User[];
}
