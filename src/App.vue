<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import MainVisualizationPage from "./views/pages/MainVisualizationPage.vue";
import DemoPage from "./views/pages/DemoPage.vue";
import "./styles.css";

type RoutePath = "/" | "/demo";

const routes: Array<{ path: RoutePath; label: string }> = [
  { path: "/", label: "Main Visualization" },
  { path: "/demo", label: "Demo" }
];

const currentPath = ref<RoutePath>(normalizePath(typeof window !== "undefined" ? window.location.pathname : "/"));
const currentPage = computed(() => (currentPath.value === "/demo" ? DemoPage : MainVisualizationPage));

function normalizePath(pathname: string): RoutePath {
  return pathname === "/demo" || pathname === "/two-layer-demo" || pathname === "/two-layer-multiscale" ? "/demo" : "/";
}

function syncFromLocation(): void {
  const normalized = normalizePath(window.location.pathname);
  if (window.location.pathname !== normalized) {
    window.history.replaceState({}, "", normalized);
  }
  currentPath.value = normalized;
}

function onNavigate(path: RoutePath, event: MouseEvent): void {
  event.preventDefault();
  if (currentPath.value === path) {
    return;
  }
  window.history.pushState({}, "", path);
  currentPath.value = path;
  window.scrollTo({ top: 0, behavior: "auto" });
}

onMounted(() => {
  syncFromLocation();
  window.addEventListener("popstate", syncFromLocation);
});

onBeforeUnmount(() => {
  window.removeEventListener("popstate", syncFromLocation);
});
</script>

<template>
  <div class="route-shell">
    <nav class="route-nav" aria-label="Primary">
      <a
        v-for="route in routes"
        :key="route.path"
        :href="route.path"
        :class="{ 'is-active': currentPath === route.path }"
        @click="onNavigate(route.path, $event)"
      >
        {{ route.label }}
      </a>
    </nav>

    <component :is="currentPage" />
  </div>
</template>
