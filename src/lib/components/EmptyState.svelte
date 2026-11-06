<script lang="ts">
  import SniplexLogo from './SniplexLogo.svelte';

  let { mode = 'snip' }: { mode?: 'snip' | 'record' } = $props();

  const prompt = $derived(
    mode === 'record'
      ? 'Press Super + Shift + R to start a recording'
      : 'Press Super + Shift + S to start a snip'
  );
</script>

<div class="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#f3f4f6] dark:bg-[#0d0f14] select-none transition-colors duration-150">
  <!-- Ambient background watermark logo -->
  <div class="opacity-[0.07] dark:opacity-[0.06] pointer-events-none select-none transition-opacity duration-300">
    <SniplexLogo size={160} showText={false} />
  </div>
  <p class="mt-4 text-sm text-neutral-500 dark:text-neutral-400" data-testid="empty-state-prompt">{prompt}</p>
</div>
