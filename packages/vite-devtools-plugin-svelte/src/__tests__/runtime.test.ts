import { describe, it, expect } from 'vite-plus/test'
import { RUNTIME_MODULE_ID, RESOLVED_RUNTIME_ID, runtimeCode, WRAPPER_MODULE_ID, wrapperCode } from '../runtime.js'

// =====================================================================
// Module Constants
// =====================================================================

describe('runtime module constants', () => {
  it('should export the correct virtual module ID', () => {
    expect(RUNTIME_MODULE_ID).toBe('virtual:svelte-devtools-runtime')
  })

  it('should export the resolved module ID with null byte prefix', () => {
    expect(RESOLVED_RUNTIME_ID).toBe('\0virtual:svelte-devtools-runtime')
  })

  it('should export the wrapper module ID with null byte prefix', () => {
    expect(WRAPPER_MODULE_ID).toBe('\0svelte-devtools:wrapped-client')
  })

  it('should export non-empty runtime code', () => {
    expect(runtimeCode.length).toBeGreaterThan(0)
  })

  it('should export non-empty wrapper code', () => {
    expect(wrapperCode.length).toBeGreaterThan(0)
  })
})

// =====================================================================
// Wrapper Code Structure
// =====================================================================

describe('wrapper code structure', () => {
  it('should import from svelte/internal/client', () => {
    expect(wrapperCode).toContain("from 'svelte/internal/client'")
  })

  it('should re-export everything from svelte/internal/client', () => {
    expect(wrapperCode).toContain("export * from 'svelte/internal/client'")
  })

  it('should export wrapped push function', () => {
    expect(wrapperCode).toContain('export function push(')
  })

  it('should export wrapped pop function', () => {
    expect(wrapperCode).toContain('export function pop(')
  })

  it('should export wrapped state function', () => {
    expect(wrapperCode).toContain('export function state(')
  })

  it('should export wrapped derived function', () => {
    expect(wrapperCode).toContain('export function derived(')
  })

  it('should export wrapped proxy function', () => {
    expect(wrapperCode).toContain('export function proxy(')
  })

  it('should export wrapped tag function', () => {
    expect(wrapperCode).toContain('export function tag(')
  })

  it('should export wrapped tag_proxy function', () => {
    expect(wrapperCode).toContain('export function tag_proxy(')
  })

  it('should export wrapped user_effect function', () => {
    expect(wrapperCode).toContain('export function user_effect(')
  })

  it('should export wrapped user_pre_effect function', () => {
    expect(wrapperCode).toContain('export function user_pre_effect(')
  })

  it('should delegate to __svelte_original for all wrapped functions', () => {
    expect(wrapperCode).toContain('__svelte_original.push.apply')
    expect(wrapperCode).toContain('__svelte_original.pop.apply')
    expect(wrapperCode).toContain('__svelte_original.state.apply')
    expect(wrapperCode).toContain('__svelte_original.derived.apply')
    expect(wrapperCode).toContain('__svelte_original.proxy.apply')
    expect(wrapperCode).toContain('__svelte_original.tag.apply')
    expect(wrapperCode).toContain('__svelte_original.tag_proxy.apply')
    expect(wrapperCode).toContain('__svelte_original.user_effect.apply')
    expect(wrapperCode).toContain('__svelte_original.user_pre_effect.apply')
  })

  it('should use __dt() helper for devtools access', () => {
    expect(wrapperCode).toContain('function __dt()')
    expect(wrapperCode).toContain('window.__SVELTE_DEVTOOLS__')
  })

  it('should maintain a component ID stack', () => {
    expect(wrapperCode).toContain('__idStack')
    expect(wrapperCode).toContain('__currentId()')
  })

  it('should track pending signal type for tag()', () => {
    expect(wrapperCode).toContain('__pendingSignal')
    // The wrapper sets __pendingSignal.type in state/derived/proxy functions
    expect(wrapperCode).toContain("__pendingSignal.type = 'state'")
    expect(wrapperCode).toContain("__pendingSignal.type = 'derived'")
    expect(wrapperCode).toContain("__pendingSignal.type = 'proxy'")
  })

  it('push should read _pendingFile and call register()', () => {
    expect(wrapperCode).toContain('dt._pendingFile')
    expect(wrapperCode).toContain('dt.register(file)')
  })

  it('push should call startInit()', () => {
    expect(wrapperCode).toContain('dt.startInit(id)')
  })

  it('push should register cleanup via __svelte_original.user_effect', () => {
    // Uses the REAL user_effect (not wrapped) to avoid recursion
    expect(wrapperCode).toContain('__svelte_original.user_effect')
    expect(wrapperCode).toContain('dt.unmount(id)')
  })

  it('pop should call endInit() and registered()', () => {
    expect(wrapperCode).toContain('dt.endInit(id)')
    expect(wrapperCode).toContain('dt.registered(id)')
  })

  it('tag should distinguish state from derived using __pendingSignal', () => {
    expect(wrapperCode).toContain('__pendingSignal.ref === signal')
    expect(wrapperCode).toContain('dt.trackState(')
    expect(wrapperCode).toContain('dt.trackDerived(')
  })

  it('tag_proxy should call trackProxy()', () => {
    expect(wrapperCode).toContain('dt.trackProxy(')
  })

  it('user_effect should call trackEffect()', () => {
    expect(wrapperCode).toContain('dt.trackEffect(')
    expect(wrapperCode).toContain('dt._effectCounter')
  })

  it('should be parseable JavaScript', () => {
    expect(() => {
      const testCode = wrapperCode
        .replace(/import .* from .*/g, '// import removed')
        .replace(/export \* from .*/g, '// re-export removed')
        .replace(/export function/g, 'function')
      new Function(testCode)
    }).not.toThrow()
  })
})

// =====================================================================
// Runtime Code Structure
// =====================================================================

describe('runtime code structure', () => {
  it('should initialize __SVELTE_DEVTOOLS__ on window', () => {
    expect(runtimeCode).toContain('window.__SVELTE_DEVTOOLS__')
  })

  it('should only initialize once', () => {
    expect(runtimeCode).toContain('!window.__SVELTE_DEVTOOLS__')
  })

  it('should have _pendingFile property', () => {
    expect(runtimeCode).toContain('_pendingFile: null')
  })

  it('should have _effectCounter property', () => {
    expect(runtimeCode).toContain('_effectCounter: 0')
  })

  it('should have register() method', () => {
    expect(runtimeCode).toContain('register(file)')
  })

  it('should have trackState/trackDerived/trackProxy/trackEffect methods', () => {
    expect(runtimeCode).toContain('trackState(signal, name, componentId)')
    expect(runtimeCode).toContain('trackDerived(signal, name, componentId)')
    expect(runtimeCode).toContain('trackProxy(proxy, name, componentId)')
    expect(runtimeCode).toContain('trackEffect(effect, name, componentId)')
  })

  it('trackProxy should NOT use probeSignals (simplified)', () => {
    expect(runtimeCode).not.toContain('probeSignals')
    expect(runtimeCode).not.toContain('_probeSignals')
  })

  it('should NOT have __registerEffect (removed, handled by wrapper)', () => {
    expect(runtimeCode).not.toContain('__registerEffect')
  })

  it('should use WeakRef for signal tracking', () => {
    expect(runtimeCode).toContain('new WeakRef(')
  })

  it('should poll state values for timeline', () => {
    expect(runtimeCode).toContain('setInterval')
    expect(runtimeCode).toContain('_pollStateValues')
  })

  it('should limit state timeline to 500 entries', () => {
    expect(runtimeCode).toContain('_stateTimeline.length >= 500')
  })

  it('should capture runtime errors', () => {
    expect(runtimeCode).toContain("window.addEventListener('error'")
    expect(runtimeCode).toContain("window.addEventListener('unhandledrejection'")
  })

  it('should listen for HMR events from server', () => {
    expect(runtimeCode).toContain("import.meta.hot.on('svelte-devtools:request-reactive-graph'")
    expect(runtimeCode).toContain("import.meta.hot.on('svelte-devtools:request-state-timeline'")
    expect(runtimeCode).toContain("import.meta.hot.on('svelte-devtools:clear-state-timeline'")
  })

  it('should be parseable JavaScript', () => {
    expect(() => {
      const testCode = runtimeCode.replace(/import\.meta\.hot/g, 'null')
      new Function(testCode)
    }).not.toThrow()
  })
})
