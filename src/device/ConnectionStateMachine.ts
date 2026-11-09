import type { ConnectionState, StateChangeCallback } from './types.ts';
import { DeviceError } from './DeviceError.ts';

export class ConnectionStateMachine {
  private _currentState: ConnectionState = 'disconnected';
  private readonly _listeners = new Set<StateChangeCallback>();
  private readonly _history: Array<{ state: ConnectionState; timestamp: string }> = [];

  constructor(initialState: ConnectionState = 'disconnected') {
    this._currentState = initialState;
    this._history.push({ state: initialState, timestamp: new Date().toISOString() });
  }

  get state(): ConnectionState {
    return this._currentState;
  }

  get history(): ReadonlyArray<{ state: ConnectionState; timestamp: string }> {
    return this._history;
  }

  subscribe(listener: StateChangeCallback): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  transitionTo(nextState: ConnectionState): void {
    if (this._currentState === nextState) {
      return;
    }

    if (!this.isValidTransition(this._currentState, nextState)) {
      throw new DeviceError(
        'ALREADY_CONNECTED',
        `Illegal state transition from '${this._currentState}' to '${nextState}'.`
      );
    }

    const previousState = this._currentState;
    this._currentState = nextState;
    this._history.push({ state: nextState, timestamp: new Date().toISOString() });

    for (const listener of this._listeners) {
      try {
        listener(nextState, previousState);
      } catch (err) {
        console.error('Error in state machine listener:', err);
      }
    }
  }

  private isValidTransition(from: ConnectionState, to: ConnectionState): boolean {
    // Error can transition to disconnected (reset) or disconnecting
    if (from === 'error') {
      return to === 'disconnected' || to === 'disconnecting';
    }

    // Any state can transition to error on failure
    if (to === 'error') {
      return true;
    }

    // Any non-disconnected state can transition to disconnecting
    if (to === 'disconnecting') {
      return from !== 'disconnected';
    }

    switch (from) {
      case 'disconnected':
        return to === 'requesting_permission';

      case 'requesting_permission':
        return to === 'connecting' || to === 'disconnected';

      case 'connecting':
        return to === 'connected';

      case 'connected':
        return to === 'identifying' || to === 'reading' || to === 'disconnecting';

      case 'identifying':
        return to === 'connected' || to === 'reading';

      case 'reading':
        return to === 'connected';

      case 'disconnecting':
        return to === 'disconnected';

      default:
        return false;
    }
  }

  reset(): void {
    this._currentState = 'disconnected';
    this._history.push({ state: 'disconnected', timestamp: new Date().toISOString() });
  }
}
