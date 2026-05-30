<script lang="ts">
  import { onMount } from 'svelte'

  let { particleCount = $bindable(80) }: { particleCount?: number } = $props()

  let canvas: HTMLCanvasElement
  let running = $state(true)

  interface P {
    x: number
    y: number
    vx: number
    vy: number
    r: number
    hue: number
  }

  onMount(() => {
    const ctx = canvas.getContext('2d')!
    const w = (canvas.width = canvas.clientWidth)
    const h = (canvas.height = 200)
    let particles: P[] = []

    function reset() {
      particles = Array.from({ length: particleCount }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        r: Math.random() * 3 + 1,
        hue: Math.random() * 360,
      }))
    }
    reset()

    let raf = 0
    function tick() {
      if (particles.length !== particleCount) reset()
      ctx.fillStyle = 'rgba(15, 17, 21, 0.25)'
      ctx.fillRect(0, 0, w, h)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > w) p.vx *= -1
        if (p.y < 0 || p.y > h) p.vy *= -1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `hsl(${p.hue}, 80%, 65%)`
        ctx.fill()
      }
      if (running) raf = requestAnimationFrame(tick)
    }

    $effect(() => {
      if (running) {
        raf = requestAnimationFrame(tick)
      }
      return () => cancelAnimationFrame(raf)
    })

    return () => cancelAnimationFrame(raf)
  })
</script>

<div class="card">
  <h3>アニメーション（FPS Monitor 確認用）</h3>
  <canvas bind:this={canvas}></canvas>
  <div class="controls">
    <label>
      パーティクル数: {particleCount}
      <input type="range" min="10" max="800" bind:value={particleCount} />
    </label>
    <button onclick={() => (running = !running)}>
      {running ? '一時停止' : '再開'}
    </button>
  </div>
</div>

<style>
  canvas {
    width: 100%;
    height: 200px;
    background: var(--bg);
    border-radius: 8px;
    border: 1px solid var(--border);
    display: block;
  }
  .controls {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 10px;
  }
  label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
</style>
