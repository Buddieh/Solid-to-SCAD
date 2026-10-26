// 3D preview: parts laid out like the exported "all" view.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PART_COLORS = [0x6f9c80, 0xe8e3d8, 0x4f7cac, 0xe0a458, 0xc8553d, 0x8a6fb0];

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.camera.up.set(0, 0, 1); // STL files are Z-up
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888070, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, -2, 3);
    this.scene.add(sun);
    this.renderer.domElement.addEventListener('dblclick', () => { this.framed = false; this.frame(new THREE.Box3().setFromObject(this.content)); this.render(); });
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.framed = false;
    new ResizeObserver(() => this.resize()).observe(container);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.setBackground());
    this.setBackground();
    this.resize();
  }

  setBackground() {
    const css = getComputedStyle(document.documentElement).getPropertyValue('--view').trim() || '#e9e6e0';
    this.scene.background = new THREE.Color(css);
    this.render();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    // false: leave the canvas's CSS size to the stylesheet. A fixed pixel size here would stop
    // #view shrinking, so a scrollbar appearing could push the page into a resize loop.
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** @param {{mesh: {points: Float64Array, faces: Uint32Array}, offsetX: number}[]} parts */
  show(parts) {
    for (const child of [...this.content.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      this.content.remove(child);
    }
    const all = new THREE.Box3();
    parts.forEach(({ mesh, offsetX }, i) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.points), 3));
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.faces), 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: PART_COLORS[i % PART_COLORS.length], roughness: 0.55, flatShading: true,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.x = offsetX;
      this.content.add(m);
      geo.computeBoundingBox();
      all.union(geo.boundingBox.clone().translate(new THREE.Vector3(offsetX, 0, 0)));
    });
    if (!all.isEmpty() && !this.framed) this.frame(all);
    this.render();
  }

  frame(box) {
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    const dir = new THREE.Vector3(-0.55, -1, 0.75).normalize();
    this.camera.position.copy(c.clone().add(dir.multiplyScalar(dist)));
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.controls.update();
    this.framed = true;
  }

  reset() { this.framed = false; }

  render() { this.renderer.render(this.scene, this.camera); }
}
