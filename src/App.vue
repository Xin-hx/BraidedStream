<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import WorkbenchPage from "./WorkbenchPage.vue";
import MultiscaleLabPage from "./views/MultiscaleLabPage.vue";

const SUPPORTED_PATHS = new Set(["/", "/multiscale-lab"]);

const currentPath = ref(normalizePath(typeof window !== "undefined" ? window.location.pathname : "/"));

const currentPage = computed(() => (currentPath.value === "/multiscale-lab" ? "lab" : "workbench"));

function normalizePath(pathname: string): "/" | "/multiscale-lab" {
  return SUPPORTED_PATHS.has(pathname) && pathname === "/multiscale-lab" ? "/multiscale-lab" : "/";
}

function syncFromLocation(): void {
  const normalized = normalizePath(window.location.pathname);
  if (window.location.pathname !== normalized) {
    window.history.replaceState({}, "", normalized);
  }
  currentPath.value = normalized;
}

function onNavigate(next: "/" | "/multiscale-lab", event: MouseEvent): void {
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
        href="/multiscale-lab"
        :class="{ 'is-active': currentPage === 'lab' }"
        @click="onNavigate('/multiscale-lab', $event)"
      >
        Multiscale Lab
      </a>
    </nav>

    <WorkbenchPage v-if="currentPage === 'workbench'" />
    <MultiscaleLabPage v-else />
  </div>
</template>
