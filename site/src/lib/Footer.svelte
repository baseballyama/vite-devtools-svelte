<script lang="ts">
  import { base } from '$app/paths'
  import { pkgVersion } from './version'

  const year = new Date().getFullYear()
</script>

<footer>
  <div class="container">
    <div class="top">
      <div class="brand">
        <div class="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M12 2 L22 12 L12 22 L2 12 Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
            />
            <path
              d="M7 12 L12 7 L17 12 L12 17 Z"
              fill="currentColor"
              opacity="0.85"
            />
          </svg>
        </div>
        <div>
          <div class="brand-line">
            <strong>vite-devtools-svelte</strong>
            <span class="mono dim">// MIT</span>
          </div>
          <p class="muted small">
            DevTools for Svelte, inside Vite. Open-source, dev-only,
            zero production overhead.
          </p>
        </div>
      </div>

      <div class="columns">
        <section>
          <h4>Docs</h4>
          <ul>
            <li><a href="{base}/getting-started">Getting Started</a></li>
            <li><a href="{base}/#panels">All panels</a></li>
            <li><a href="{base}/try">Try Live</a></li>
          </ul>
        </section>
        <section>
          <h4>Project</h4>
          <ul>
            <li>
              <a
                href="https://github.com/baseballyama/vite-devtools-svelte"
                target="_blank"
                rel="noreferrer noopener">GitHub</a
              >
            </li>
            <li>
              <a
                href="https://github.com/baseballyama/vite-devtools-svelte/issues"
                target="_blank"
                rel="noreferrer noopener">Issues</a
              >
            </li>
            <li>
              <a
                href="https://github.com/baseballyama/vite-devtools-svelte/releases"
                target="_blank"
                rel="noreferrer noopener">Releases</a
              >
            </li>
          </ul>
        </section>
      </div>
    </div>

    <div class="bottom">
      <div class="mono small dim">
        <span class="dot"></span>
        live · v{pkgVersion} · © {year}
      </div>
      <div class="mono small dim">
        crafted for Svelte 5 · Vite ≥ 8
      </div>
    </div>
  </div>
</footer>

<style>
  footer {
    border-top: 1px solid var(--line);
    margin-top: 6rem;
    padding: 3rem 0 2rem;
    color: var(--text-2);
    font-size: 0.92rem;
    background:
      linear-gradient(
        to bottom,
        transparent,
        color-mix(in srgb, var(--paper) 50%, transparent)
      );
  }

  .top {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 3rem;
    padding-bottom: 2.5rem;
    border-bottom: 1px solid var(--line);
  }

  @media (max-width: 720px) {
    .top {
      grid-template-columns: 1fr;
      gap: 2rem;
    }
  }

  .brand {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    max-width: 420px;
  }

  .mark {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--brand);
    background: var(--paper);
  }

  .brand-line {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.2rem;
    color: var(--text);
  }

  .brand-line strong {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 0.92rem;
    letter-spacing: -0.01em;
  }

  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    margin-bottom: 0.4rem;
  }

  a {
    color: var(--text-2);
    font-size: 0.9rem;
  }

  a:hover {
    color: var(--text);
    text-decoration: none;
  }

  .bottom {
    margin-top: 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .small {
    font-size: 0.78rem;
  }

  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    margin-right: 0.35rem;
    vertical-align: 1px;
  }

  h4 {
    margin-bottom: 0.7rem;
  }
</style>
