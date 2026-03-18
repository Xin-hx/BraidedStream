import { loadCovidBundle } from "../core/datasets";

export async function loadCovidPrepared(layerLimit = 24) {
  return loadCovidBundle(layerLimit);
}
