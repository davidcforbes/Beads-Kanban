/**
 * BFS-based hierarchical layout algorithm for dependency graphs
 * Assigns nodes to layers based on dependency depth and calculates positions
 */

/**
 * Find root nodes (nodes with no incoming edges)
 * @param {Array} nodes - Array of graph nodes
 * @param {Array} edges - Array of graph edges
 * @returns {Array} Array of root node IDs
 */
function findRootNodes(nodes, edges) {
  const hasIncoming = new Set();

  // Mark all nodes that have incoming edges
  for (const edge of edges) {
    hasIncoming.add(edge.to);
  }

  // Return nodes with no incoming edges
  const roots = nodes
    .filter(node => !hasIncoming.has(node.id))
    .map(node => node.id);

  // If no roots found (all nodes are in cycles), pick the first node
  return roots.length > 0 ? roots : [nodes[0]?.id].filter(Boolean);
}

/**
 * Build adjacency map from edges
 * @param {Array} edges - Array of graph edges
 * @returns {Map} Map of nodeId -> array of child nodeIds
 */
function buildAdjacencyMap(edges) {
  const adjacencyMap = new Map();

  for (const edge of edges) {
    if (!adjacencyMap.has(edge.from)) {
      adjacencyMap.set(edge.from, []);
    }
    adjacencyMap.get(edge.from).push(edge.to);
  }

  return adjacencyMap;
}

/**
 * Detect cycles in the graph using DFS
 * @param {Map} adjacencyMap - Adjacency map
 * @param {Array} nodes - Array of nodes
 * @returns {Set} Set of node IDs involved in cycles
 */
function detectCycles(adjacencyMap, nodes) {
  const cycleNodes = new Set();
  const visited = new Set();
  const recursionStack = new Set();

  function dfs(nodeId) {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const children = adjacencyMap.get(nodeId) || [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        if (dfs(childId)) {
          cycleNodes.add(nodeId);
          return true;
        }
      } else if (recursionStack.has(childId)) {
        // Found a cycle
        cycleNodes.add(nodeId);
        cycleNodes.add(childId);
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return cycleNodes;
}

/**
 * Assign nodes to layers using BFS
 * @param {Array} nodes - Array of graph nodes
 * @param {Array} edges - Array of graph edges
 * @returns {Array} Array of layers, each containing node IDs
 */
function assignLayers(nodes, edges) {
  // Special case: if there are no edges, all nodes are disconnected
  if (!edges || edges.length === 0) {
    return {
      layers: [],
      nodeToLayer: new Map(),
      unvisitedNodes: nodes.map(n => n.id)
    };
  }

  const adjacencyMap = buildAdjacencyMap(edges);
  const layers = [];
  const visited = new Set();
  const nodeToLayer = new Map();

  // Start with root nodes
  let queue = findRootNodes(nodes, edges);
  let currentLayer = 0;

  while (queue.length > 0) {
    const nextQueue = [];
    const currentLayerNodes = [];

    for (const nodeId of queue) {
      if (visited.has(nodeId)) continue;

      visited.add(nodeId);
      currentLayerNodes.push(nodeId);
      nodeToLayer.set(nodeId, currentLayer);

      // Add children to next layer
      const children = adjacencyMap.get(nodeId) || [];
      for (const childId of children) {
        if (!visited.has(childId) && !nextQueue.includes(childId)) {
          nextQueue.push(childId);
        }
      }
    }

    if (currentLayerNodes.length > 0) {
      layers.push(currentLayerNodes);
    }

    queue = nextQueue;
    currentLayer++;
  }

  // Collect any unvisited nodes (disconnected or in cycles)
  const unvisited = nodes.filter(n => !visited.has(n.id));

  return { layers, nodeToLayer, unvisitedNodes: unvisited.map(n => n.id) };
}

/**
 * Calculate node positions based on layers
 * @param {Array} nodes - Array of graph nodes
 * @param {Array} layers - Array of layers
 * @param {Map} nodeToLayer - Map of nodeId to layer index
 * @param {Array} unvisitedNodeIds - IDs of disconnected nodes
 * @param {Object} options - Layout options
 * @returns {Array} Nodes with calculated x, y positions
 */
function calculatePositions(nodes, layers, nodeToLayer, unvisitedNodeIds, options) {
  const {
    direction = 'TB', // TB (top-bottom) or LR (left-right)
    nodeWidth = 200,
    nodeHeight = 80,
    horizontalSpacing = 250,
    verticalSpacing = 120
  } = options;

  const positioned = [];

  // Position connected nodes in layers
  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const nodesInLayer = layers[layerIdx];
    const layerWidth = nodesInLayer.length * horizontalSpacing;
    const startX = -(layerWidth / 2) + (horizontalSpacing / 2);

    for (let i = 0; i < nodesInLayer.length; i++) {
      const nodeId = nodesInLayer[i];
      const node = nodes.find(n => n.id === nodeId);

      if (!node) continue;

      if (direction === 'TB') {
        // Top to bottom layout
        node.x = startX + (i * horizontalSpacing);
        node.y = layerIdx * verticalSpacing;
      } else {
        // Left to right layout
        node.x = layerIdx * horizontalSpacing;
        node.y = startX + (i * verticalSpacing);
      }

      node.layer = layerIdx;
      positioned.push(node);
    }
  }

  // Position disconnected nodes in a grid layout
  if (unvisitedNodeIds && unvisitedNodeIds.length > 0) {
    const disconnectedNodes = unvisitedNodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean);

    // Calculate grid dimensions (approximately square)
    const gridCols = Math.ceil(Math.sqrt(disconnectedNodes.length));
    const gridRows = Math.ceil(disconnectedNodes.length / gridCols);

    // Position below connected nodes (or at origin if no connected nodes)
    const baseY = layers.length > 0 ? (layers.length + 1) * verticalSpacing : 0;
    const gridWidth = gridCols * horizontalSpacing;
    const gridStartX = -(gridWidth / 2) + (horizontalSpacing / 2);

    for (let i = 0; i < disconnectedNodes.length; i++) {
      const node = disconnectedNodes[i];
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);

      node.x = gridStartX + (col * horizontalSpacing);
      node.y = baseY + (row * verticalSpacing);
      node.layer = layers.length + row;
      positioned.push(node);
    }
  }

  return positioned;
}

/**
 * Compute hierarchical layout for a dependency graph
 * @param {Object} graphData - Graph data with nodes and edges
 * @param {Object} options - Layout options
 * @returns {Object} Layout result with positioned nodes and metadata
 */
export function computeHierarchicalLayout(graphData, options = {}) {
  const { nodes, edges } = graphData;

  if (!nodes || nodes.length === 0) {
    return { nodes: [], edges: [], cycleNodes: new Set(), metadata: { layerCount: 0 } };
  }

  // Detect cycles
  const adjacencyMap = buildAdjacencyMap(edges);
  const cycleNodes = detectCycles(adjacencyMap, nodes);

  // Assign nodes to layers using BFS
  const { layers, nodeToLayer, unvisitedNodes } = assignLayers(nodes, edges);

  // Calculate positions (includes grid layout for disconnected nodes)
  const positioned = calculatePositions(nodes, layers, nodeToLayer, unvisitedNodes, options);

  return {
    nodes: positioned,
    edges,
    cycleNodes,
    metadata: {
      layerCount: layers.length,
      layers: layers.map(layer => layer.length),
      disconnectedCount: unvisitedNodes.length
    }
  };
}

/**
 * Filter graph to focus on a specific node and its dependencies
 * @param {Object} graphData - Graph data with nodes and edges
 * @param {string} focusNodeId - ID of the node to focus on
 * @param {number} depth - Number of levels to traverse
 * @returns {Object} Filtered graph data
 */
export function focusOnNode(graphData, focusNodeId, depth = 2) {
  const { nodes, edges } = graphData;
  const includedNodes = new Set();
  const includedEdges = [];

  // BFS to find all nodes within depth levels
  const adjacencyMap = buildAdjacencyMap(edges);
  const reverseAdjacencyMap = new Map();

  // Build reverse adjacency map (parent -> children becomes children -> parent)
  for (const edge of edges) {
    if (!reverseAdjacencyMap.has(edge.to)) {
      reverseAdjacencyMap.set(edge.to, []);
    }
    reverseAdjacencyMap.get(edge.to).push(edge.from);
  }

  // BFS forward (dependencies)
  let queue = [{ id: focusNodeId, level: 0 }];
  const visited = new Set();

  while (queue.length > 0) {
    const { id, level } = queue.shift();

    if (visited.has(id) || level > depth) continue;

    visited.add(id);
    includedNodes.add(id);

    // Add children
    const children = adjacencyMap.get(id) || [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        queue.push({ id: childId, level: level + 1 });
      }
    }

    // Add parents (reverse edges)
    const parents = reverseAdjacencyMap.get(id) || [];
    for (const parentId of parents) {
      if (!visited.has(parentId)) {
        queue.push({ id: parentId, level: level + 1 });
      }
    }
  }

  // Filter nodes and edges
  const filteredNodes = nodes.filter(n => includedNodes.has(n.id));
  const filteredEdges = edges.filter(e =>
    includedNodes.has(e.from) && includedNodes.has(e.to)
  );

  return {
    nodes: filteredNodes,
    edges: filteredEdges
  };
}
