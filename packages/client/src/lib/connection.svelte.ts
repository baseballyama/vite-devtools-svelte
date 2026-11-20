import { getConnectionState, onConnectionState, type ConnectionState } from './rpc.js';

let state = $state<ConnectionState>(getConnectionState());

onConnectionState(s => {
  state = s;
});

export const connection = {
  get state() {
    return state;
  },
};
