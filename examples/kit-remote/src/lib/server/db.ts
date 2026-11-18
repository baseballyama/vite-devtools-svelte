// In-memory data shared by the remote functions and the classic load.
export type Todo = { id: number; text: string; done: boolean };
export type User = { id: number; name: string };

let nextId = 4;
export const todos: Todo[] = [
  { id: 1, text: 'Open the Svelte DevTools', done: true },
  { id: 2, text: 'Watch a remote query resolve', done: false },
  { id: 3, text: 'Toggle me with a command', done: false },
];

export const users: User[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `user-${i + 1}`,
}));

export function addTodo(text: string): Todo {
  const todo = { id: nextId++, text, done: false };
  todos.push(todo);
  return todo;
}

export const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
