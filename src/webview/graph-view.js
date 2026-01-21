/**
 * Graph visualization using vanilla JavaScript and SVG
 * Renders nodes and edges for dependency graphs with drag-and-drop support
 */

import { computeHierarchicalLayout, focusOnNode } from './graph-layout.js';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const NODE_PADDING = 10;
const ARROW_SIZE = 8;

export class GraphView {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      onNodeClick: null,
      onNodeDrag: null,
      direction: 'TB',
      ...options
    };

    this.svg = null;
    this.edgesGroup = null;
    this.nodesGroup = null;
    this.transform = { x: 0, y: 0, scale: 1 };
    this.dragState = null;
    this.selectedNodeIds = new Set(); // Multi-select support
    this.currentNodes = []; // Store current nodes for edge updates
    this.currentEdges = []; // Store current edges for updates
    this.rubberBandState = null; // For rubber band selection
    this.contextMenu = null; // Context menu element

    this.init();
  }

  init() {
    // Create SVG element
    this.svg = document.getElementById('graphSvg');
    if (!this.svg) {
      console.error('Graph SVG element not found');
      return;
    }

    // Clear existing content
    while (this.svg.firstChild) {
      this.svg.removeChild(this.svg.firstChild);
    }

    // Create arrow marker definitions
    this.createArrowMarkers();

    // Create groups for edges and nodes (edges rendered first, below nodes)
    this.edgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.edgesGroup.setAttribute('class', 'edges-group');
    this.svg.appendChild(this.edgesGroup);

    this.nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.nodesGroup.setAttribute('class', 'nodes-group');
    this.svg.appendChild(this.nodesGroup);

    // Set up pan/zoom handlers
    this.setupPanZoom();
  }

  createArrowMarkers() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Arrow marker for parent-child relationships
    const markerParent = this.createMarker('arrow-parent', 'var(--vscode-charts-green)');
    defs.appendChild(markerParent);

    // Arrow marker for blocks relationships
    const markerBlocks = this.createMarker('arrow-blocks', 'var(--vscode-charts-red)');
    defs.appendChild(markerBlocks);

    // Arrow marker for blocked-by relationships
    const markerBlockedBy = this.createMarker('arrow-blocked-by', 'var(--vscode-charts-orange)');
    defs.appendChild(markerBlockedBy);

    this.svg.appendChild(defs);
  }

  createMarker(id, color) {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('markerWidth', ARROW_SIZE);
    marker.setAttribute('markerHeight', ARROW_SIZE);
    marker.setAttribute('refX', ARROW_SIZE - 1);
    marker.setAttribute('refY', ARROW_SIZE / 2);
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'userSpaceOnUse');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} Z`);
    path.setAttribute('fill', color);
    marker.appendChild(path);

    return marker;
  }

  setupPanZoom() {
    let isPanning = false;
    let startPoint = { x: 0, y: 0 };
    let selectionRect = null;

    this.svg.addEventListener('mousedown', (e) => {
      // Rubber band selection with Shift key on empty canvas
      if (e.shiftKey && (e.target === this.svg || e.target === this.edgesGroup || e.target === this.nodesGroup)) {
        const svgPoint = this.getSVGPoint(e);
        this.rubberBandState = {
          startX: svgPoint.x,
          startY: svgPoint.y,
          currentX: svgPoint.x,
          currentY: svgPoint.y
        };

        // Create selection rectangle
        selectionRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        selectionRect.setAttribute('class', 'selection-rectangle');
        this.svg.appendChild(selectionRect);
        e.preventDefault();
      } else if (e.target === this.svg || e.target === this.edgesGroup || e.target === this.nodesGroup) {
        // Pan on empty canvas without Shift
        isPanning = true;
        startPoint = { x: e.clientX - this.transform.x, y: e.clientY - this.transform.y };
        e.preventDefault();
      }
    });

    this.svg.addEventListener('mousemove', (e) => {
      if (this.rubberBandState && selectionRect) {
        // Update rubber band selection rectangle
        const svgPoint = this.getSVGPoint(e);
        this.rubberBandState.currentX = svgPoint.x;
        this.rubberBandState.currentY = svgPoint.y;

        const x = Math.min(this.rubberBandState.startX, this.rubberBandState.currentX);
        const y = Math.min(this.rubberBandState.startY, this.rubberBandState.currentY);
        const width = Math.abs(this.rubberBandState.currentX - this.rubberBandState.startX);
        const height = Math.abs(this.rubberBandState.currentY - this.rubberBandState.startY);

        selectionRect.setAttribute('x', x);
        selectionRect.setAttribute('y', y);
        selectionRect.setAttribute('width', width);
        selectionRect.setAttribute('height', height);
        e.preventDefault();
      } else if (isPanning) {
        // Pan the view
        this.transform.x = e.clientX - startPoint.x;
        this.transform.y = e.clientY - startPoint.y;
        this.applyTransform();
        e.preventDefault();
      }
    });

    this.svg.addEventListener('mouseup', (e) => {
      if (this.rubberBandState && selectionRect) {
        // Complete rubber band selection
        this.selectNodesInRectangle(
          Math.min(this.rubberBandState.startX, this.rubberBandState.currentX),
          Math.min(this.rubberBandState.startY, this.rubberBandState.currentY),
          Math.abs(this.rubberBandState.currentX - this.rubberBandState.startX),
          Math.abs(this.rubberBandState.currentY - this.rubberBandState.startY),
          e.ctrlKey || e.metaKey
        );

        // Remove selection rectangle
        selectionRect.remove();
        selectionRect = null;
        this.rubberBandState = null;
      }
      isPanning = false;
    });

    this.svg.addEventListener('mouseleave', () => {
      if (selectionRect) {
        selectionRect.remove();
        selectionRect = null;
      }
      this.rubberBandState = null;
      isPanning = false;
    });

    // Zoom with mouse wheel
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom(delta);
    });

    // Context menu (right-click)
    this.svg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY);
    });

    // Hide context menu on click elsewhere
    document.addEventListener('click', (e) => {
      const contextMenu = document.getElementById('graphContextMenu');
      if (contextMenu && !contextMenu.contains(e.target)) {
        contextMenu.classList.add('hidden');
      }
    });
  }

  getSVGPoint(event) {
    // Convert screen coordinates to SVG coordinates (accounting for transform)
    const rect = this.svg.getBoundingClientRect();
    const x = (event.clientX - rect.left - this.transform.x) / this.transform.scale;
    const y = (event.clientY - rect.top - this.transform.y) / this.transform.scale;
    return { x, y };
  }

  selectNodesInRectangle(x, y, width, height, addToSelection = false) {
    if (!addToSelection) {
      this.clearSelection();
    }

    for (const node of this.currentNodes) {
      // Check if node's center is within the rectangle
      const nodeX = node.x + NODE_WIDTH / 2;
      const nodeY = node.y + NODE_HEIGHT / 2;

      if (nodeX >= x && nodeX <= x + width && nodeY >= y && nodeY <= y + height) {
        this.selectedNodeIds.add(node.id);
        const nodeElement = this.nodesGroup.querySelector(`[data-node-id="${node.id}"]`);
        if (nodeElement) {
          nodeElement.classList.add('selected');
          const rect = nodeElement.querySelector('.node-bg');
          if (rect) {
            rect.setAttribute('stroke-width', '4');
            rect.setAttribute('stroke-dasharray', '8, 4');
          }
        }
      }
    }

    this.updateSidebarSelection();
  }

  showContextMenu(x, y) {
    const contextMenu = document.getElementById('graphContextMenu');
    if (!contextMenu) return;

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');

    // Enable/disable menu items based on selection
    const linkItem = contextMenu.querySelector('[data-action="link"]');
    const unlinkItem = contextMenu.querySelector('[data-action="unlink"]');

    if (linkItem) {
      if (this.selectedNodeIds.size >= 2) {
        linkItem.classList.remove('disabled');
      } else {
        linkItem.classList.add('disabled');
      }
    }

    if (unlinkItem) {
      if (this.selectedNodeIds.size >= 1) {
        unlinkItem.classList.remove('disabled');
      } else {
        unlinkItem.classList.add('disabled');
      }
    }
  }

  applyTransform() {
    const transform = `translate(${this.transform.x}, ${this.transform.y}) scale(${this.transform.scale})`;
    this.nodesGroup.setAttribute('transform', transform);
    this.edgesGroup.setAttribute('transform', transform);
  }

  zoom(factor) {
    const oldScale = this.transform.scale;
    this.transform.scale *= factor;
    this.transform.scale = Math.max(0.1, Math.min(3, this.transform.scale)); // Clamp between 0.1 and 3

    // Adjust position to zoom toward center
    const scaleChange = this.transform.scale - oldScale;
    const rect = this.svg.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    this.transform.x -= (centerX - this.transform.x) * (scaleChange / oldScale);
    this.transform.y -= (centerY - this.transform.y) * (scaleChange / oldScale);

    this.applyTransform();
  }

  resetView() {
    this.transform = { x: 0, y: 0, scale: 1 };
    this.applyTransform();
  }

  clearSavedPositions() {
    // Clear any saved manual node positions
    // This forces auto-layout to recalculate from scratch
    // TODO: Implement position persistence if needed
    console.log('Cleared saved node positions - will recalculate layout');
  }

  centerView(nodes) {
    if (!nodes || nodes.length === 0) return;

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_WIDTH);
      maxY = Math.max(maxY, node.y + NODE_HEIGHT);
    }

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    const rect = this.svg.getBoundingClientRect();
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;

    // Calculate scale to fit graph (use more viewport space)
    const scaleX = (rect.width * 0.95) / graphWidth;
    const scaleY = (rect.height * 0.95) / graphHeight;
    // Allow zooming in up to 1.5x for better readability, minimum 0.1x
    this.transform.scale = Math.max(0.1, Math.min(scaleX, scaleY, 1.5));

    // Center the graph
    this.transform.x = viewportCenterX - (graphCenterX * this.transform.scale);
    this.transform.y = viewportCenterY - (graphCenterY * this.transform.scale);

    this.applyTransform();
  }

  render(cards, layoutOptions = {}) {
    // Build graph data from cards
    const graphData = this.buildGraphData(cards);

    // Apply focus mode if specified
    let filteredData = graphData;
    if (layoutOptions.focusMode && layoutOptions.focusNodeId) {
      filteredData = focusOnNode(
        graphData,
        layoutOptions.focusNodeId,
        layoutOptions.focusDepth || 2
      );
    }

    // Compute layout
    const layout = computeHierarchicalLayout(filteredData, {
      direction: layoutOptions.direction || 'TB',
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
      horizontalSpacing: layoutOptions.horizontalSpacing || 250,
      verticalSpacing: layoutOptions.verticalSpacing || 120
    });

    // Store nodes and edges for drag updates
    this.currentNodes = layout.nodes;
    this.currentEdges = layout.edges;

    // Clear existing content
    while (this.edgesGroup.firstChild) {
      this.edgesGroup.removeChild(this.edgesGroup.firstChild);
    }
    while (this.nodesGroup.firstChild) {
      this.nodesGroup.removeChild(this.nodesGroup.firstChild);
    }

    // Render edges
    for (const edge of layout.edges) {
      const sourceNode = layout.nodes.find(n => n.id === edge.from);
      const targetNode = layout.nodes.find(n => n.id === edge.to);
      if (sourceNode && targetNode) {
        this.renderEdge(edge, sourceNode, targetNode);
      }
    }

    // Render nodes
    for (const node of layout.nodes) {
      this.renderNode(node, layout.cycleNodes.has(node.id));
    }

    // Set up SVG viewBox to allow scrolling/panning beyond initial viewport
    this.setupViewBox(layout.nodes);

    // Note: centerView is NOT called here - viewBox with xMidYMid meet handles centering
    // User can manually click "Center View" button if needed
    // this.centerView(layout.nodes);

    return layout;
  }

  setupViewBox(nodes) {
    if (!nodes || nodes.length === 0) return;

    // Calculate bounding box with generous padding
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_WIDTH);
      maxY = Math.max(maxY, node.y + NODE_HEIGHT);
    }

    // Add padding (50% on each side) to allow dragging beyond initial bounds
    const paddingX = (maxX - minX) * 0.5;
    const paddingY = (maxY - minY) * 0.5;
    const viewBoxX = minX - paddingX;
    const viewBoxY = minY - paddingY;
    const viewBoxWidth = (maxX - minX) + (paddingX * 2);
    const viewBoxHeight = (maxY - minY) + (paddingY * 2);

    // Remove explicit width/height - let SVG fill container (100% from CSS)
    // This allows transform-based centering to work properly
    this.svg.removeAttribute('width');
    this.svg.removeAttribute('height');

    // Set viewBox for coordinate system
    this.svg.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }

  buildGraphData(cards) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    const edgeSet = new Set(); // Track edges to prevent duplicates

    // Create nodes from cards
    for (const card of cards) {
      nodes.push({
        id: card.id,
        card: card,
        x: 0,
        y: 0,
        layer: 0
      });
      nodeMap.set(card.id, card);
    }

    // Helper to add edge only if both nodes exist and edge doesn't already exist
    const addEdge = (from, to, type) => {
      const edgeKey = `${from}->${to}:${type}`;
      if (nodeMap.has(from) && nodeMap.has(to) && !edgeSet.has(edgeKey)) {
        edges.push({ from, to, type });
        edgeSet.add(edgeKey);
      }
    };

    // Extract edges from dependencies
    for (const card of cards) {
      // Parent-child relationships (only from parent's children array to avoid duplicates)
      if (card.children && Array.isArray(card.children)) {
        for (const child of card.children) {
          addEdge(card.id, child.id, 'parent-child');
        }
      }

      // Blocks relationships (only from blocker's perspective)
      if (card.blocks && Array.isArray(card.blocks)) {
        for (const blocked of card.blocks) {
          addEdge(card.id, blocked.id, 'blocks');
        }
      }

      // For orphaned children (have parent but parent doesn't list them)
      // This handles cases where data might be incomplete
      if (card.parent && nodeMap.has(card.parent.id)) {
        addEdge(card.parent.id, card.id, 'parent-child');
      }

      // For orphaned blocked issues (have blocker but blocker doesn't list them)
      if (card.blocked_by && Array.isArray(card.blocked_by)) {
        for (const blocker of card.blocked_by) {
          addEdge(blocker.id, card.id, 'blocked-by');
        }
      }
    }

    return { nodes, edges };
  }

  renderNode(node, isInCycle = false) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'graph-node');
    g.setAttribute('data-node-id', node.id);
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

    // Background rectangle
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');

    // Map status to color class (Ready=yellow, InProgress=green, Blocked=red, Closed=gray)
    let statusClass = node.card.status;
    if (node.card.status === 'open' && node.card.is_ready) {
      statusClass = 'ready';
    }

    rect.setAttribute('class', `node-bg status-${statusClass}`);
    rect.setAttribute('width', NODE_WIDTH);
    rect.setAttribute('height', NODE_HEIGHT);
    rect.setAttribute('rx', '4');
    if (isInCycle) {
      rect.setAttribute('stroke-dasharray', '5,5');
      rect.setAttribute('stroke-width', '3');
    }
    g.appendChild(rect);

    // Title text
    const title = node.card.title || 'Untitled';
    const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    titleText.setAttribute('class', 'node-title');
    titleText.setAttribute('x', NODE_PADDING);
    titleText.setAttribute('y', 25);
    titleText.textContent = this.truncateText(title, 22);
    g.appendChild(titleText);

    // ID text
    const idText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    idText.setAttribute('class', 'node-id');
    idText.setAttribute('x', NODE_PADDING);
    idText.setAttribute('y', 45);
    idText.textContent = node.card.id;
    g.appendChild(idText);

    // Type badge
    if (node.card.type) {
      const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      typeText.setAttribute('class', 'node-type');
      typeText.setAttribute('x', NODE_PADDING);
      typeText.setAttribute('y', 65);
      typeText.textContent = node.card.type;
      g.appendChild(typeText);
    }

    // Cycle warning icon
    if (isInCycle) {
      const warningText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      warningText.setAttribute('class', 'node-warning');
      warningText.setAttribute('x', NODE_WIDTH - 25);
      warningText.setAttribute('y', 25);
      warningText.textContent = '⚠';
      warningText.setAttribute('title', 'Part of circular dependency');
      g.appendChild(warningText);
    }

    // Event handlers
    g.style.cursor = 'move';

    // Single click to select (for visual thinking/repositioning)
    // Ctrl/Cmd-click for multi-select
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectNode(node, e.ctrlKey || e.metaKey);
    });

    // Double-click to open edit form
    g.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.handleNodeDoubleClick(node);
    });

    g.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.startDrag(node, e);
    });

    this.nodesGroup.appendChild(g);
  }

  renderEdge(edge, sourceNode, targetNode) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `edge edge-${edge.type}`);
    path.setAttribute('data-edge-from', edge.from);
    path.setAttribute('data-edge-to', edge.to);
    path.setAttribute('data-edge-type', edge.type);

    // Calculate connection points
    const sourceX = sourceNode.x + NODE_WIDTH / 2;
    const sourceY = sourceNode.y + NODE_HEIGHT;
    const targetX = targetNode.x + NODE_WIDTH / 2;
    const targetY = targetNode.y;

    // Create Bezier curve
    const controlPointOffset = Math.abs(targetY - sourceY) / 2;
    const d = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + controlPointOffset}, ${targetX} ${targetY - controlPointOffset}, ${targetX} ${targetY}`;
    path.setAttribute('d', d);

    // Set marker (arrow)
    let marker = 'arrow-parent';
    if (edge.type === 'blocks') marker = 'arrow-blocks';
    else if (edge.type === 'blocked-by') marker = 'arrow-blocked-by';
    path.setAttribute('marker-end', `url(#${marker})`);

    // Add dashed style for blocks edges
    if (edge.type === 'blocks' || edge.type === 'blocked-by') {
      path.setAttribute('stroke-dasharray', '5,5');
    }

    this.edgesGroup.appendChild(path);
  }

  selectNode(node, ctrlKey = false) {
    // Multi-select with Ctrl/Cmd key
    if (ctrlKey) {
      if (this.selectedNodeIds.has(node.id)) {
        // Deselect if already selected
        this.selectedNodeIds.delete(node.id);
        const nodeElement = this.nodesGroup.querySelector(`[data-node-id="${node.id}"]`);
        if (nodeElement) {
          nodeElement.classList.remove('selected');
          const rect = nodeElement.querySelector('.node-bg');
          if (rect) {
            rect.setAttribute('stroke-width', '2');
            rect.removeAttribute('stroke-dasharray');
          }
        }
      } else {
        // Add to selection
        this.selectedNodeIds.add(node.id);
        const nodeElement = this.nodesGroup.querySelector(`[data-node-id="${node.id}"]`);
        if (nodeElement) {
          nodeElement.classList.add('selected');
          const rect = nodeElement.querySelector('.node-bg');
          if (rect) {
            rect.setAttribute('stroke-width', '4');
            rect.setAttribute('stroke-dasharray', '8, 4');
          }
        }
      }
    } else {
      // Single select - clear previous selection
      this.clearSelection();
      this.selectedNodeIds.add(node.id);
      const nodeElement = this.nodesGroup.querySelector(`[data-node-id="${node.id}"]`);
      if (nodeElement) {
        nodeElement.classList.add('selected');
        const rect = nodeElement.querySelector('.node-bg');
        if (rect) {
          rect.setAttribute('stroke-width', '4');
          rect.setAttribute('stroke-dasharray', '8, 4');
        }
      }
    }

    // Update sidebar selection
    this.updateSidebarSelection();
  }

  clearSelection() {
    // Remove visual selection from all selected nodes
    for (const nodeId of this.selectedNodeIds) {
      const nodeElement = this.nodesGroup.querySelector(`[data-node-id="${nodeId}"]`);
      if (nodeElement) {
        nodeElement.classList.remove('selected');
        const rect = nodeElement.querySelector('.node-bg');
        if (rect) {
          rect.setAttribute('stroke-width', '2');
          rect.removeAttribute('stroke-dasharray');
        }
      }
    }
    this.selectedNodeIds.clear();
  }

  updateSidebarSelection() {
    // Update sidebar issue list selection
    const issueList = document.getElementById('graphIssueList');
    if (!issueList) return;

    const items = issueList.querySelectorAll('.graph-issue-item');
    for (const item of items) {
      const issueId = item.getAttribute('data-issue-id');
      if (this.selectedNodeIds.has(issueId)) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    }
  }

  handleNodeDoubleClick(node) {
    if (this.options.onNodeClick) {
      this.options.onNodeClick(node.card);
    }
  }

  startDrag(node, event) {
    this.dragState = {
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      nodeStartX: node.x,
      nodeStartY: node.y
    };

    const handleMouseMove = (e) => {
      if (!this.dragState) return;

      const dx = (e.clientX - this.dragState.startX) / this.transform.scale;
      const dy = (e.clientY - this.dragState.startY) / this.transform.scale;

      node.x = this.dragState.nodeStartX + dx;
      node.y = this.dragState.nodeStartY + dy;

      // Update node position
      const nodeElement = this.nodesGroup.querySelector(`[data-node-id="${node.id}"]`);
      if (nodeElement) {
        nodeElement.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      }

      // Update connected edges
      this.updateConnectedEdges(node.id);

      e.preventDefault();
    };

    const handleMouseUp = () => {
      if (this.dragState && this.options.onNodeDrag) {
        this.options.onNodeDrag(node.id, node.x, node.y);
      }
      this.dragState = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  updateConnectedEdges(nodeId) {
    // Find all edges connected to this node
    const connectedEdges = this.currentEdges.filter(
      edge => edge.from === nodeId || edge.to === nodeId
    );

    // Re-render each connected edge
    for (const edge of connectedEdges) {
      const sourceNode = this.currentNodes.find(n => n.id === edge.from);
      const targetNode = this.currentNodes.find(n => n.id === edge.to);

      if (!sourceNode || !targetNode) continue;

      // Find the specific edge element using data attributes
      const edgeSelector = `path[data-edge-from="${edge.from}"][data-edge-to="${edge.to}"][data-edge-type="${edge.type}"]`;
      const edgeEl = this.edgesGroup.querySelector(edgeSelector);

      if (edgeEl) {
        // Calculate new connection points
        const sourceX = sourceNode.x + NODE_WIDTH / 2;
        const sourceY = sourceNode.y + NODE_HEIGHT;
        const targetX = targetNode.x + NODE_WIDTH / 2;
        const targetY = targetNode.y;

        // Update the path
        const controlPointOffset = Math.abs(targetY - sourceY) / 2;
        const d = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + controlPointOffset}, ${targetX} ${targetY - controlPointOffset}, ${targetX} ${targetY}`;
        edgeEl.setAttribute('d', d);
      }
    }
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  getSelectedNodeId() {
    return this.selectedNodeId;
  }

  setSelectedNode(nodeId) {
    this.selectedNodeId = nodeId;
    // TODO: Highlight selected node
  }
}
