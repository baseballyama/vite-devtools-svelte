<script lang="ts">
  interface User {
    id: number
    name: string
    email: string
    role: 'admin' | 'editor' | 'viewer'
  }

  const allUsers: User[] = [
    { id: 1, name: 'Alice', email: 'alice@example.com', role: 'admin' },
    { id: 2, name: 'Bob', email: 'bob@example.com', role: 'editor' },
    { id: 3, name: 'Charlie', email: 'charlie@example.com', role: 'viewer' },
    { id: 4, name: 'Diana', email: 'diana@example.com', role: 'editor' },
    { id: 5, name: 'Eve', email: 'eve@example.com', role: 'admin' },
    { id: 6, name: 'Frank', email: 'frank@example.com', role: 'viewer' },
  ]

  let query = $state('')
  let roleFilter = $state<string>('all')
  let selectedUser = $state<User | null>(null)

  let filtered = $derived.by(() => {
    let result = allUsers
    if (roleFilter !== 'all') {
      result = result.filter(u => u.role === roleFilter)
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter(u =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      )
    }
    return result
  })

  let resultCount = $derived(filtered.length)
  let hasSelection = $derived(selectedUser !== null)

  $effect(() => {
    // Clear selection when filtered results change and selected user is no longer in list
    if (selectedUser && !filtered.some(u => u.id === selectedUser!.id)) {
      selectedUser = null
    }
  })
</script>

<div class="search">
  <h3>User Search</h3>
  <div class="filters">
    <input type="text" placeholder="Search name or email..." bind:value={query} />
    <select bind:value={roleFilter}>
      <option value="all">All Roles</option>
      <option value="admin">Admin</option>
      <option value="editor">Editor</option>
      <option value="viewer">Viewer</option>
    </select>
  </div>
  <div class="count">{resultCount} user{resultCount !== 1 ? 's' : ''} found</div>
  <ul>
    {#each filtered as user (user.id)}
      <li>
        <button
          class="user-item"
          class:selected={selectedUser?.id === user.id}
          onclick={() => selectedUser = selectedUser?.id === user.id ? null : user}
        >
          <span class="name">{user.name}</span>
          <span class="badge {user.role}">{user.role}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if hasSelection}
    <div class="detail">
      <strong>{selectedUser!.name}</strong>
      <span>{selectedUser!.email}</span>
      <span class="badge {selectedUser!.role}">{selectedUser!.role}</span>
    </div>
  {/if}
</div>

<style>
  .search {
    background: #1e1e3a; border: 1px solid #2a2a4a; border-radius: 8px; padding: 16px;
  }
  h3 { color: #ff3e00; margin-bottom: 12px; }
  .filters { display: flex; gap: 8px; margin-bottom: 8px; }
  input[type='text'] {
    flex: 1; background: #12122a; border: 1px solid #2a2a4a; border-radius: 4px;
    padding: 6px 8px; color: #e0e0e0; font-size: 13px;
  }
  input:focus { outline: none; border-color: #ff3e00; }
  select {
    background: #12122a; border: 1px solid #2a2a4a; border-radius: 4px;
    padding: 6px 8px; color: #e0e0e0; font-size: 13px;
  }
  .count { font-size: 11px; color: #666; margin-bottom: 8px; }
  ul { list-style: none; max-height: 180px; overflow-y: auto; }
  li { margin-bottom: 2px; }
  .user-item {
    width: 100%; display: flex; justify-content: space-between; align-items: center;
    background: none; border: 1px solid transparent; border-radius: 4px; padding: 6px 8px;
    color: #ccc; cursor: pointer; font-family: inherit; font-size: 13px; text-align: left;
  }
  .user-item:hover { background: #2a2a4a; }
  .user-item.selected { border-color: #ff3e00; background: rgba(255, 62, 0, 0.1); }
  .badge {
    font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: 600;
  }
  .badge.admin { background: #4c1d95; color: #c4b5fd; }
  .badge.editor { background: #1e3a5f; color: #93c5fd; }
  .badge.viewer { background: #1a3a2a; color: #86efac; }
  .detail {
    margin-top: 8px; padding: 8px; background: #12122a; border-radius: 4px;
    display: flex; align-items: center; gap: 8px; font-size: 13px; color: #ccc;
  }
</style>
