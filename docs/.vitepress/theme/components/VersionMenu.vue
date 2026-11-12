<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vitepress';
import type { DefaultTheme } from 'vitepress/theme';
import VPNavMenuGroup from 'vitepress/dist/client/theme-default/components/VPNavMenuGroup.vue';

export interface VersionNavItem extends DefaultTheme.NavItemWithLink {
  label?: string;
}

const props = defineProps<{
  latest: string;
  items: VersionNavItem[];
  screenMenu?: boolean;
  menu?: boolean;
}>();

const route = useRoute();

const currentLabel = computed(() => {
  if (route.data.isNotFound) return 'Version';
  const path = '/' + route.data.relativePath.replace(/(?:(^|\/)index)?\.(?:md|html)$/, '$1');
  const matched = props.items.find(
    (item) => item.label && item.activeMatch && new RegExp(item.activeMatch).test(path),
  );
  return matched?.label ?? `${props.latest} (latest)`;
});

const menuItem = computed<DefaultTheme.NavItemWithChildren>(() => ({
  text: currentLabel.value,
  // Keep the trigger label neutral; the active item inside the menu marks the current version
  activeMatch: '^$',
  items: props.items,
}));
</script>

<template>
  <VPNavMenuGroup
    :item="menuItem"
    :screen="Boolean(screenMenu)"
    :menu="Boolean(menu)"
  />
</template>
