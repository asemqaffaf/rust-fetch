<script setup lang="ts">
import { useData } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import ArchivedHomeBanner from './components/ArchivedHomeBanner.vue';

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
  <Layout>
    <template #home-hero-before>
      <ArchivedHomeBanner
        v-if="frontmatter.archiveNotice"
        :notice="frontmatter.archiveNotice"
      />
    </template>
  </Layout>
</template>
