# SineStream: Algorithm Analysis & Implementation

## Overview
SineStream improves streamgraph readability by minimizing **sine illusion effects** (the tendency to perceive orthogonal rather than vertical distance between curves). The algorithm achieves this through two main components:

1. **Baseline Computation** - Uses Gaussian weighting to penalize layers with large thickness changes
2. **Layer Ordering** - Employs hierarchical clustering to arrange layers optimally

---

## 1. BASELINE COMPUTATION ALGORITHM

### Main Function: `StreamLayout_2norm_Gauss(layers, cType, options)`

**Purpose**: Computes an optimal baseline (the bottom-most curve) that minimizes visual distortion.

```javascript
function StreamLayout_2norm_Gauss(layers, cType = "median", options = {doFlat: false}) {
    var baseline = getArray(layers[0].size.length, 0);

    for (let i = 0; i < layers[0].size.length; i++) {
        let totalSize = 0;
        for (let j = 0; j < layers.length; j++) {
            totalSize += layers[j].size[i];
        }
        
        if (i == 0) {
            baseline[i] = (0 - totalSize * 0.5);
            continue;
        }
        
        let C = getC_2norm_Gauss(layers, i, cType);
        let deltaG = getDeltaG_2norm_Gauss(layers, C, i);
        baseline[i] = baseline[i - 1] + deltaG;
    }
    
    if (options.doFlat) {
        baseline = baseline.map(d => 0)
    }
    
    layers = stackOnBaseline(layers, baseline);
    return layers;
}
```

### Key Parameters in Baseline Computation

#### 1. **C Value Computation** - `getC_2norm_Gauss(curLayers, timePoint, cType)`

The C value represents the **thickness change metric**. Supported types:

- **"median"** (default): Median of absolute thickness changes
- **"mean"**: Arithmetic mean of thickness changes
- **"geometric"**: Geometric mean (resistant to skewed distributions)
- **"harmonic"**: Harmonic mean (emphasizes smaller values)

```javascript
function getC_2norm_Gauss(curLayers, timePoint, cType = "median") {
    let totalDFi = []; // Store thickness changes for all layers
    let curC = 1;
    
    // Calculate dFi[] - thickness change for each layer
    for (let j = 0; j < curLayers.length; j++) {
        let cur1 = getSize(curLayers, j, timePoint);
        let cur2 = getSize(curLayers, j, timePoint - 1);
        totalDFi.push(Math.abs(cur1 - cur2));
    }
    
    // Apply specified aggregation method
    switch (cType) {
        case "median":
            totalDFi.sort((a, b) => a - b);
            if (totalDFi.length % 2 !== 0) {
                curC = totalDFi[(totalDFi.length - 1) / 2];
            } else {
                curC = (totalDFi[totalDFi.length / 2] + totalDFi[totalDFi.length / 2 - 1]) / 2;
            }
            break;
        case "mean":
            curC = totalDFi.reduce((a, b) => a + b) / totalDFi.length;
            break;
        // ... other cases
    }
    return curC;
}
```

#### 2. **Gaussian-Weighted Baseline Shift** - `getDeltaG_2norm_Gauss(layers, c, i)`

This is the core innovation - it applies **Gaussian weighting** to penalize layers with large thickness changes.

**Mathematical Formula**:
$$\Delta g_i = -\frac{\sum_{j=0}^{n} w_j \cdot Q_i^j}{\sum_{j=0}^{n} w_j}$$

Where:
- $w_j = e^{-\frac{(dF_i^j)^2}{2c^2}}$ (Gaussian weight - penalizes large changes)
- $dF_i^j$ = thickness change of layer j at time i
- $Q_i^j$ = cumulative adjustment term
- $c$ = thickness change metric (median/mean of all layer changes)

```javascript
function getDeltaG_2norm_Gauss(layers, c, i) {
    let deltaG = 0;
    let dFi = [];      // Thickness changes
    let Fi = [];       // Layer sizes
    let Qi = [];       // Cumulative adjustments
    
    // Calculate dFi and Fi
    for (let j = 0; j < layers.length; j++) {
        let cur1 = getSize(layers, j, i);
        let cur2 = getSize(layers, j, i - 1);
        Fi.push(cur1);
        dFi.push(cur1 - cur2);
    }
    
    // Calculate Qi (cumulative contribution)
    for (let j = 0; j < layers.length; j++) {
        let p = 0;
        for (let k = 0; k <= j; k++) {
            p += 2 * dFi[k];
        }
        Qi.push((p - dFi[j]) / 2);
    }
    
    // Apply Gaussian weighting
    let numerator = 0;
    let denominator = 0;
    
    for (let j = 0; j < layers.length; j++) {
        // Gaussian weight: exp(-(dFi² / 2c²))
        let gaussParameter = 1;
        if (c !== 0) {
            gaussParameter = Math.pow(Math.E, (0 - (dFi[j] * dFi[j]) / (2 * c * c)));
        }
        
        let cur = gaussParameter * Fi[j];
        denominator += cur;
        numerator += cur * Qi[j];
    }
    
    deltaG = -(numerator / denominator);
    return deltaG;
}
```

#### 3. **Stacking on Baseline** - `stackOnBaseline(layers, baseline)`

```javascript
function stackOnBaseline(layers, baseline) {
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        layer.yBottom = baseline.slice(0);
        
        for (var j = 0; j < baseline.length; j++) {
            baseline[j] += layer.size[j];
        }
        
        layer.yTop = baseline.slice(0);
    }
    return layers;
}
```

---

## 2. LAYER ORDERING ALGORITHM

### Function: `HierarchicalClusteringOrder(layers, weightType)`

Uses **bottom-up hierarchical clustering** with dynamic programming to find optimal layer ordering while minimizing sine illusion.

```javascript
function HierarchicalClusteringOrder(layers, weightType = "max") {
    let layerNodes = [];
    layers = JSON.parse(JSON.stringify(layers));
    layers = shuffle(layers);  // Random initialization
    
    let curIndex = 0;
    for (let i = 0; i < layers.length; i++) {
        layerNodes.push(new LayerNode(curIndex, layers[i]));
        layers[i].index = curIndex;
        curIndex++;
    }
    
    let finalLayersOrder = [];
    
    if (layers.length > 1) {
        // Build distance matrix
        let distanceMatrix = getArray2D(layerNodes.length * 2 - 1, 
                                        layerNodes.length * 2 - 1, -1);
        
        for (let i = 0; i < layers.length * 2 - 1; i++) {
            distanceMatrix[i][i] = 0;
        }
        
        // Hierarchical clustering
        while (layerNodes.length > 1) {
            let layerToPick_A, layerToPick_B;
            let minLayerDistance = Infinity;
            
            // Find closest pair
            for (let j = 0; j < layerNodes.length - 1; j++) {
                for (let k = j + 1; k < layerNodes.length; k++) {
                    let cur = 0;
                    if (distanceMatrix[layerNodes[j].index][layerNodes[k].index] === -1) {
                        cur = getDistance_LayerNode(layerNodes[j], layerNodes[k], weightType);
                        distanceMatrix[layerNodes[j].index][layerNodes[k].index] = cur;
                        distanceMatrix[layerNodes[k].index][layerNodes[j].index] = cur;
                    } else {
                        cur = distanceMatrix[layerNodes[j].index][layerNodes[k].index];
                    }
                    
                    if (cur < minLayerDistance) {
                        minLayerDistance = cur;
                        layerToPick_A = j;
                        layerToPick_B = k;
                    }
                }
            }
            
            // Merge clusters
            layerNodes.push(new LayerNode(curIndex, layerNodes[layerToPick_A], 
                                          layerNodes[layerToPick_B]));
            curIndex++;
            layerNodes.splice(layerToPick_B, 1);
            layerNodes.splice(layerToPick_A, 1);
        }
        
        // Extract optimal ordering using dynamic programming
        let mMatrix = [];
        for (let i = 0; i < layers.length * 2 - 1; i++) {
            mMatrix.push(new Map());
        }
        mMatrix = getOrder_HierarchicalClustering(layerNodes[0], distanceMatrix, mMatrix);
        
        finalLayersOrder = [];
        let curValue = Infinity;
        for (var [key, value] of mMatrix[layers.length * 2 - 1 - 1]) {
            if (value[0] < curValue) {
                curValue = value[0];
                finalLayersOrder = value[1];
            }
        }
    }
    
    // Sort layers by final order
    layers.sort(function (a, b) {
        return finalLayersOrder.indexOf(a.index) - finalLayersOrder.indexOf(b.index);
    });
    
    return layers;
}
```

### Distance Metric: `getDistance_LayerNode(layerA, layerB, weightType)`

**Three Design Requirements**:

1. **Angle-based Similarity**: Minimize angle between layers' curves
2. **Size-based Weighting**: Adjust by combined layer thickness
3. **Length Weighting**: Penalize thin or short-lived layers

```javascript
function getDistance_LayerNode(layerA, layerB, weightType = "max") {
    let timePoint_start = 0;
    let timePoint_end = layerA.size.length - 1;
    let countD = timePoint_end - timePoint_start;
    
    // 1. ANGLE-BASED SIMILARITY
    let distance = 0;
    for (let i = timePoint_start; i < timePoint_end; i++) {
        if (Math.abs(layerA.dFi[i]) + Math.abs(layerB.dFi[i]) === 0) {
            // Handle zero thickness change case
            if ((layerA.size[i+1] + layerB.size[i+1] === 0) &&
                (layerA.size[i] + layerB.size[i] === 0)) {
                countD--;
                continue;
            } else {
                distance += 0;
            }
        } else {
            // Core formula: |ΔA + ΔB| / (|ΔA| + |ΔB|)
            // This measures angle between the curves
            distance += Math.abs(layerA.dFi[i] + layerB.dFi[i]) / 
                       (Math.abs(layerA.dFi[i]) + Math.abs(layerB.dFi[i]));
        }
    }
    
    if (countD !== 0) {
        distance /= countD;
    }
    
    // 2. SIZE-BASED WEIGHTING
    let sizeWeight = 0;
    let countW = 0;
    
    switch (weightType.toLowerCase()) {
        case "max":
            let curMaxSize = -Infinity;
            for (let i = timePoint_start; i <= timePoint_end; i++) {
                curMaxSize = Math.max(curMaxSize, layerA.size[i] + layerB.size[i]);
            }
            sizeWeight = curMaxSize;
            break;
        case "arithmetic":
            let arithmeticSum = 0;
            for (let i = timePoint_start; i <= timePoint_end; i++) {
                if (layerA.size[i] + layerB.size[i] !== 0) {
                    arithmeticSum += (layerA.size[i] + layerB.size[i]);
                    countW++;
                }
            }
            sizeWeight = countW !== 0 ? arithmeticSum / countW : 0;
            break;
        case "geometric":
            // Geometric mean of combined sizes
            sizeWeight = 1;
            countW = 0;
            for (let i = timePoint_start; i <= timePoint_end; i++) {
                if (layerA.size[i] + layerB.size[i] !== 0) countW++;
            }
            if (countW !== 0) {
                for (let i = timePoint_start; i <= timePoint_end; i++) {
                    if (layerA.size[i] + layerB.size[i] !== 0) {
                        sizeWeight *= Math.pow(layerA.size[i] + layerB.size[i], 1/countW);
                    }
                }
            } else {
                sizeWeight = 0;
            }
            break;
        // ... harmonic and median cases
    }
    
    // 3. LENGTH WEIGHTING (Penalty for thin/short-lived layers)
    let lengthWeight = 0;
    let maxSizeA = layerA.size.reduce((a, b) => Math.max(a, b));
    let maxSizeB = layerB.size.reduce((a, b) => Math.max(a, b));
    
    let minTimes = lengthWeightThresholdValue; // Default: 9
    let length_ASize = 0;
    let length_BSize = 0;
    
    for (let i = timePoint_start; i <= timePoint_end; i++) {
        if (layerA.size[i] > maxSizeA / minTimes) length_ASize++;
        if (layerB.size[i] > maxSizeB / minTimes) length_BSize++;
    }
    
    if (length_ASize === 0 || length_BSize === 0) {
        lengthWeight = 1;
    } else {
        lengthWeight = Math.max((layerA.size.length / length_ASize),
                               (layerA.size.length / length_BSize));
    }
    
    // Final distance with weights
    distance *= (whetherUseThicknessWeight ? sizeWeight : 1);
    distance *= (whetherUseLengthWeight ? lengthWeight : 1);
    
    return distance;
}
```

### Optimal Ordering - Dynamic Programming: `getOrder_HierarchicalClustering()`

Uses DP to find the optimal left-to-right ordering of leaf nodes in the cluster tree.

**Enumeration Strategy** - 4 possible configurations for each internal node:
```javascript
let enumNodes = [
    [0, 0, 1, 1],  // leftLeft, rightRight, leftRight, rightLeft
    [0, 1, 1, 0],
    [1, 0, 0, 1],
    [1, 1, 0, 0]
];
```

Recurrence: $M(v, u, w) = \min \{ M(left, u, m) + M(right, k, w) + S(m, k) \}$

---

## 3. LAYER NODE CLASS

```javascript
class LayerNode {
    constructor(index, nodeA, nodeB = undefined) {
        this.index = index;
        this.id = '';
        this.name = "";
        this.size = [];
        this.leave = undefined;
        this.fillcolor = "black";
        this.leftChild = undefined;
        this.rightChild = undefined;
        
        // Statistics
        this.dFi = [];      // Thickness changes
        this.maxSize = -Infinity;
        
        // Leaf node
        if (nodeB === undefined) {
            this.name = nodeA.name;
            this.size = nodeA.size.slice();
            this.leave = nodeA;
            this.fillcolor = nodeA.fillcolor;
            this.id = nodeA.id;
        }
        // Internal node (combines two children)
        else {
            this.id = index;
            this.name += index;
            this.size = nodeA.size.slice().map((d, i) => d + nodeB.size[i]);
            this.children = [nodeA, nodeB];
            this.leftChild = nodeA;
            this.rightChild = nodeB;
        }
        
        // Calculate statistics
        for (let i = 0; i < this.size.length; i++) {
            if (this.size[i] !== 0) {
                this.maxSize = Math.max(this.maxSize, this.size[i]);
            }
            if (i >= 1) {
                this.dFi.push(this.size[i] - this.size[i - 1]);
            }
        }
    }
}
```

---

## 4. GLOBAL PARAMETERS & CONFIGURATION

```javascript
// Baseline computation parameters
let allCtype = ['mean', 'median', 'geometric', 'harmonic'];
let useAllCtype = [false, true, false, false];  // Use median by default

// Layer ordering parameters
let allThicknessType = ['max', 'arithmetic', 'geometric', 'harmonic'];
let useAllThicknessType = [true, false, false, false];  // Use max by default

// Weight toggles
let whetherUseThicknessWeight = true;
let whetherUseLengthWeight = true;

// Length weighting threshold (penalizes layers with non-zero values < 1/9 of max)
let lengthWeightThresholdValue = 9;
```

---

## 5. UTILITY FUNCTIONS

### Core Stacking Operations
```javascript
// Get layer thickness at specific time point
function getSize(layers, layerIndex, time) {
    if (layerIndex < layers.length && time < layers[0].size.length &&
        layerIndex >= 0 && time >= 0) {
        return layers[layerIndex].size[time] < 0.000001 ? 0 : 
               layers[layerIndex].size[time];
    }
    return 0;
}

// Stack layers on baseline
function stackOnBaseline(layers, baseline) {
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        layer.yBottom = baseline.slice(0);
        for (var j = 0; j < baseline.length; j++) {
            baseline[j] += layer.size[j];
        }
        layer.yTop = baseline.slice(0);
    }
    return layers;
}

// Create arrays for matrix operations
function getArray(len, value = 0) {
    let cur = [];
    for (let i = 0; i < len; i++) {
        cur.push(value);
    }
    return cur;
}

function getArray2D(lenA, lenB, value = 0) {
    let cur = [];
    for (let i = 0; i < lenA; i++) {
        cur.push([]);
        for (let j = 0; j < lenB; j++) {
            cur[i].push(value);
        }
    }
    return cur;
}

// Shuffle array (random initialization)
function shuffle(num) {
    if (num.length === 0) return;
    let num2 = JSON.parse(JSON.stringify(num));
    for (let i = num2.length - 1; i >= 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [num2[i], num2[j]] = [num2[j], num2[i]];
    }
    return num2;
}

// Get median
function getMedian(num) {
    let num2 = JSON.parse(JSON.stringify(num));
    num2.sort((a, b) => a - b);
    return num2.length % 2 === 0 ? 
        (num2[num2.length / 2 - 1] + num2[num2.length / 2]) / 2 :
        num2[(num2.length - 1) / 2];
}
```

---

## 6. WORKFLOW: END-TO-END ALGORITHM

```javascript
function drawGaph(index, currentLayers, name) {
    // 1. Apply Layer Ordering (Hierarchical Clustering)
    for (let i = 0; i < useAllThicknessType.length; i++) {
        if (useAllThicknessType[i]) {
            currentLayers = HierarchicalClusteringOrder(
                currentLayers, 
                allThicknessType[i]
            );
            
            // 2. Apply Baseline Computation (Gaussian Weighting)
            for (let j = 0; j < useAllCtype.length; j++) {
                if (useAllCtype[j]) {
                    currentLayers = StreamLayout_2norm_Gauss(
                        currentLayers, 
                        allCtype[j]
                    );
                    
                    // 3. Generate visualization
                    let graph_draw_data = getLayersData(currentLayers);
                    drawStreamGraph(graph_draw_data, {
                        raw_layer_data: currentLayers,
                        text: name,
                        dom_id: "div_streamgraph",
                        graph_count: graphCount
                    });
                }
            }
        }
    }
}
```

---

## 7. KEY MATHEMATICAL INSIGHTS

### Why Gaussian Weighting?
$$w_j = e^{-\frac{(dF_j)^2}{2c^2}}$$

- **Large thickness changes** (high $|dF_j|$) → Low weight → Less influence
- **Small thickness changes** (low $|dF_j|$) → High weight (~1) → More influence
- **Perceptual benefit**: Penalizes abrupt changes that create sine illusion artifacts

### Why Hierarchical Clustering?
- **Agglomerative approach**: Merges most similar layers iteratively
- **Similarity metric**: Combines angle, size, and length factors
- **DP optimization**: Ensures globally optimal left-to-right ordering
- **Result**: Layers with similar patterns cluster together, reducing visual complexity

### Why Three Distance Components?

1. **Angle** ($|ΔA + ΔB| / (|ΔA| + |ΔB|)$): Measures directional similarity
2. **Size Weighting**: Emphasizes important thick layers
3. **Length Weighting**: Penalizes fragmented or noisy layers

---

## 8. INPUT/OUTPUT FORMAT

### Input JSON
```json
[
    {
        "name": "Layer_1",
        "fillcolor": "rgb(166,206,227)",
        "size": [1, 2, 3, 4, 5, 6]
    },
    {
        "name": "Layer_2",
        "size": [2, 3, 4, 5, 6, 7]
    }
]
```

**Requirements**: 
- All layers must have equal-length size arrays
- Colors optional (random assigned if missing)

---

## Summary

**SineStream's Innovation**:
- Combines **Gaussian-weighted baseline** with **hierarchical cluster ordering**
- Theoretically grounded in perceptual principles (sine illusion)
- Empirically validated with quantitative experiments and user studies
- Improves both readability and aesthetic quality of streamgraphs
