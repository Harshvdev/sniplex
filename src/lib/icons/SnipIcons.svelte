<script lang="ts">
  import type { SnipType } from '../types';

  let { type, className = 'w-4 h-4' }: { type: SnipType | 'screen-markup'; className?: string } = $props();
</script>

{#if type === 'rectangle'}
  <svg viewBox="0 0 24 24" class={className} fill="none" stroke="currentColor" stroke-width="1.6">
    <!-- Rectangle body is centered at y=12 (y=6..18, height=12) matching Video & Camera icons -->
    <rect x="3" y="6" width="15" height="12" rx="2" stroke-linecap="round" />
    <!-- Plus badge at bottom-right corner -->
    <path d="M18 16.5v5m-2.5-2.5h5" stroke-width="1.8" stroke-linecap="round" />
  </svg>
{:else if type === 'window'}
  <svg viewBox="0 0 24 24" class={className} fill="none" stroke="currentColor" stroke-width="1.6">
    <!-- Window frame centered at y=12 (y=5.5..18.5) -->
    <rect x="3" y="5.5" width="15" height="13" rx="2" stroke-linecap="round" />
    <line x1="3" y1="9.5" x2="18" y2="9.5" stroke-width="1.3" />
    <!-- Plus badge at bottom-right corner -->
    <path d="M18 16.5v5m-2.5-2.5h5" stroke-width="1.8" stroke-linecap="round" />
  </svg>
{:else if type === 'fullscreen'}
  <svg viewBox="0 0 24 24" class={className} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <!-- Fullscreen corners centered at y=12 (y=4.5..19.5) -->
    <path d="M4 8.5V4.5h4m8 0h4v4m0 7v4h-4m-8 0H4v-4" />
  </svg>
{:else if type === 'freeform'}
  <svg viewBox="0 0 24 24" class={className} fill="none" stroke="currentColor" stroke-width="1.6">
    <!-- Freeform lasso centered at y=12 (y=6..18) -->
    <path d="M8.5 6c-3.5 0-5 2.8-5 6 0 4.2 2.8 6 7 6 3.2 0 5-2 5-5 0-3.2-2.2-5-5-5-2.2 0-3.2 1.3-3.2 2.2" stroke-linecap="round" />
    <!-- Plus badge at bottom-right corner -->
    <path d="M18 16.5v5m-2.5-2.5h5" stroke-width="1.8" stroke-linecap="round" />
  </svg>
{:else if type === 'screen-markup'}
  <svg viewBox="0 0 24 24" class={className} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <!-- Rectangle body aligned exactly with rectangle snip icon (x=3, y=6, w=15, h=12) -->
    <rect x="3" y="6" width="15" height="12" rx="2" stroke-linecap="round" />
    <!-- Inner image elements -->
    <circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" />
    <path d="m3.5 15 3.5-3 3.5 2.5" />
    <!-- Pencil at bottom-right corner -->
    <path d="M14 19.5l5.5-5.5 1.5 1.5-5.5 5.5-2 0.5 0.5-2z" stroke-width="1.3" fill="currentColor" fill-opacity="0.15" />
    <line x1="18" y1="14" x2="19.5" y2="15.5" stroke-width="1.2" />
  </svg>
{/if}
