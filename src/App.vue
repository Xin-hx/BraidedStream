<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import WorkbenchPage from "./WorkbenchPage.vue";
import TwoLayerMultiscalePage from "./views/TwoLayerMultiscalePage.vue";

type AppPath = "/" | "/two-layer-multiscale";

const SUPPORTED_PATHS = new Set<AppPath>(["/", "/two-layer-multiscale"]);

const currentPath = ref<AppPath>(normalizePath(typeof window !== "undefined" ? window.location.pathname : "/"));

const currentPage = computed(() => (currentPath.value === "/two-layer-multiscale" ? "twoLayer" : "workbench"));

function normalizePath(pathname: string): AppPath {
  return SUPPORTED_PATHS.has(pathname as AppPath) ? (pathname as AppPath) : "/";
}

function syncFromLocation(): void {
  const normalized = normalizePath(window.location.pathname);
  if (window.location.pathname !== normalized) {
    window.history.replaceState({}, "", normalized);
  }
  currentPath.value = normalized;
}

function onNavigate(next: AppPath, event: MouseEvent): void {
  event.preventDefault();
  if (currentPath.value === next) {
    return;
  }
  window.history.pushState({}, "", next);
  currentPath.value = next;
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
      <a href="/" :class="{ 'is-active': currentPage === 'workbench' }" @click="onNavigate('/', $event)">Workbench</a>
      <a
        href="/two-layer-multiscale"
        :class="{ 'is-active': currentPage === 'twoLayer' }"
        @click="onNavigate('/two-layer-multiscale', $event)"
      >
        Two-layer Demo
      </a>
    </nav>

    <WorkbenchPage v-if="currentPage === 'workbench'" />
    <TwoLayerMultiscalePage v-else />
  </div>
</template>
