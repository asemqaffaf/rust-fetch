<script setup lang="ts">
import { withBase } from 'vitepress';

export interface ArchiveNotice {
  version: string;
  nextVersion: string;
  changelog: string;
}

defineProps<{
  notice: ArchiveNotice;
}>();
</script>

<template>
  <div class="archived-home-banner">
    <div class="archived-home-banner-inner vp-doc">
      <div class="warning custom-block">
        <p class="custom-block-title">Documentation for {{ notice.version }}</p>
        <p>
          This documents rust-fetch {{ notice.version }}. For the latest version, see the
          <a :href="withBase('/')">current documentation</a>. The
          <a :href="notice.changelog" target="_blank" rel="noreferrer">changelog</a>
          lists what {{ notice.nextVersion }} added.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.archived-home-banner {
  padding: 1rem 1.5rem 0;
}

@media (min-width: 40rem) {
  .archived-home-banner {
    padding: 1.5rem 3rem 0;
  }
}

@media (min-width: 60rem) {
  .archived-home-banner {
    padding: 1.5rem 4rem 0;
  }
}

.archived-home-banner-inner {
  margin: 0 auto;
  max-width: 72rem;
}

.archived-home-banner .custom-block {
  margin: 0;
}
</style>
