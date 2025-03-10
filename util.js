"use strict"
import * as THREE from 'three'

// https://threejs.org/examples/#webgl_buffergeometry_rawshader
const MMGUIDE_MATERIAL = new THREE.RawShaderMaterial({
  vertexShader: `
  precision mediump float;
  precision mediump int;
  uniform mat4 modelViewMatrix; // optional
  uniform mat4 projectionMatrix; // optional
  attribute vec3 position;
  attribute vec4 color;
  varying vec3 vPosition;
  varying vec4 vColor;
  void main()	{
    vPosition = position;
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`,
  fragmentShader: `
  precision mediump float;
  precision mediump int;
  varying vec3 vPosition;
  varying vec4 vColor;
  void main()	{
    vec4 color = vec4( vColor );
    gl_FragColor = color;
  }`,
  side: THREE.DoubleSide,
  transparent: true
});

//
// reading/writing params
//

export function makeSearchParams(params) {
  const sp = params.compress ? compress(flatten(params)) : { params: JSON.stringify(params) }
  return new URLSearchParams(sp)
}

export function updateObjectFromSearchParams(obj, searchParams) {
  const from_search_params = {}
  searchParams.forEach((v, k) => from_search_params[k] = v)
  const keys = Object.keys(from_search_params)

  if (keys.length == 0) {
    return // avoids introducing compression
  }

  if (keys.length == 1 && keys[0] == 'params') {
    const params = from_search_params.params
    try {
      updateProps(obj, JSON.parse(params))
      obj.compress = false
    } catch (e) {
      console.log(`error loading params from json '${params}' message '${e.message}`)
    }
    return
  }

  if (keys.length == 1 && keys[0] == 'config') {
    const config = from_search_params.config
    try {
      console.log(`loading params from config url ${config}...`)
      const url = new URL(config)
      const req = new XMLHttpRequest()
      req.open("GET", url, false)
      req.send(null)
      const params = JSON.parse(req.responseText)
      console.log(`done loading params from config url ${config}`)
      updateProps(obj, params)
      obj.compress = false
    } catch (e) {
      console.log(`error loading params from config url '${config}' message '${e.message}`)
    }
    return
  }

  // otherwise search params are a compressed flattened object
  const flat_obj = flatten(obj)
  const unqual = k => k.slice(k.lastIndexOf('.') + 1)
  const add_unqual = (acc, [k, v]) => ({ ...acc, [unqual(k)]: v })
  const types = Object.entries(flat_obj).reduce(add_unqual, {})
  const update = uncompress(from_search_params)
  Object.entries(update).forEach(([k, v]) => {
    let x
    if (unqual(k) in types) {
      const t = typeof types[unqual(k)]
      x = castToType(v, t)
      if (x === undefined) {
        console.log(`don't know how to cast param '${k}' to type ${t}, using string ${v}`)
        x = v
      }
    } else {
      console.log(`unknown param '${k}', setting value ${v} as string`)
      x = v
    }
    flat_obj[k] = x
  })
  updateProps(obj, unflatten(flat_obj))
  obj.compress = true
}

// need this bc earch param values are always strings
// we only know a limited set of value types for simplicity
function castToType(v, t) {
  switch (t) {
    case 'boolean':
      return v == 'true'
    case 'number':
      return Number(v)
    case 'string':
      return String(v)
    default:
      return undefined
  }
}

//
// things with lines
//

export function lineSeg(start, end, color) {
  const material = new THREE.LineBasicMaterial({ color })
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
  return new THREE.Line(geometry, material)
}

// x y z axis lines from origin
export function axes() {
  const origin = new THREE.Vector3(0, 0, 0)
  const group = new THREE.Group()
  group.add(lineSeg(origin, new THREE.Vector3(128, 0, 0), new THREE.Color(1, 0, 0)))
  group.add(lineSeg(origin, new THREE.Vector3(0, 128, 0), new THREE.Color(0, 1, 0)))
  group.add(lineSeg(origin, new THREE.Vector3(0, 0, 128), new THREE.Color(0, 0, 1)))
  return group
}

export function rowGuide(h, w, light = 1.0, denom = 8) {
  const group = new THREE.Group()
  const color = new THREE.Color()

  const draw = (i0, j0, i1, j1) => {
    const start = new THREE.Vector3(j0, i0, 0)
    const end = new THREE.Vector3(j1, i1, 0)
    color.setHSL(1.0, 0.0, light)
    group.add(lineSeg(start, end, color))
  }

  draw(0, 0, h - 1, 0)
  draw(0, w - 1, h - 1, w - 1)

  const rstride = Math.max(1, (h - 1) / denom)
  for (let i = 0; i < h; i += rstride) {
    draw(i, 0, i, w - 1)
  }

  draw(0, w / denom, h / denom, 0)

  return group
}

//
// mm flow guide arrow
// 

const LEFT_ARROW_COLOR = new THREE.Uint8BufferAttribute([
  150, 200, 255, 255,
  150, 200, 255, 255,
  150, 200, 255, 255,
], 4)
LEFT_ARROW_COLOR.normalized = true

const RIGHT_ARROW_COLOR = new THREE.Uint8BufferAttribute([
  255, 150, 150, 255,
  255, 150, 150, 255,
  255, 150, 150, 255,
], 4)
RIGHT_ARROW_COLOR.normalized = true

export function flowGuide(h, d, w, layout, scale = 1.0) {
  const light = 0.5 + scale / 2
  LEFT_ARROW_COLOR.array[3] = LEFT_ARROW_COLOR.array[7] = LEFT_ARROW_COLOR.array[3] = 255 * light
  LEFT_ARROW_COLOR.needsUpdate = true
  RIGHT_ARROW_COLOR.array[3] = RIGHT_ARROW_COLOR.array[7] = RIGHT_ARROW_COLOR.array[3] = 255 * light
  RIGHT_ARROW_COLOR.needsUpdate = true

  const { left, right, result, gap, left_scatter, right_scatter } = layout
  const extent = x => x + gap * 2 - 1
  const center = x => extent(x) / 2
  const place = (n, p, x) => p == 1 ? x : n - x
  const place_left = x => place(extent(w), left, x)
  const place_right = x => place(extent(h), right, x)
  const place_result = x => place(extent(d), result, x)

  const group = new THREE.Group()

  const left_geometry = new THREE.BufferGeometry()
  left_geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    place_left(center(w) - (center(w) - gap + left_scatter) * scale),
    center(h),
    place_result(center(d)),

    place_left(center(w)),
    center(h),
    place_result(center(d)),

    place_left(center(w)),
    place_right(center(h)),
    place_result(center(d) - (center(d) - gap) * scale),
  ], 3))
  left_geometry.setAttribute('color', LEFT_ARROW_COLOR)
  group.add(new THREE.Mesh(left_geometry, MMGUIDE_MATERIAL));

  const right_geometry = new THREE.BufferGeometry()
  right_geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    center(w),
    place_right(center(h) - (center(h) - gap + right_scatter) * scale),
    place_result(center(d)),

    center(w),
    center(h),
    place_result(center(d)),

    center(w),
    place_right(center(h)),
    place_result(center(d) - (center(d) - gap) * scale),
  ], 3))
  right_geometry.setAttribute('color', RIGHT_ARROW_COLOR)
  group.add(new THREE.Mesh(right_geometry, MMGUIDE_MATERIAL));

  return group
}

//
// bounding box stuff etc
//

export function bbhwd(bb) {
  return {
    h: bb.max.y - bb.min.y,
    w: bb.max.x - bb.min.x,
    d: bb.max.z - bb.min.z,
  }
}

export function gbbhwd(g) {
  return bbhwd(g.boundingBox)
}

export function center(x, y = 0) {
  return (x - y) / 2
}

//
// misc object utils
//

function updatePropRec(obj, k, v) {
  (typeof obj[k] == 'object' && typeof v == 'object') ? updatePropsRec(obj[k], v) : (obj[k] = v)
}

export function updatePropsRec(obj, donor) {
  Object.entries(donor).forEach(([k, v]) => updatePropRec(obj, k, v))
}

export function updateProps(obj, donor) {
  Object.entries(donor).forEach(([k, v]) => obj[k] = v)
}

export function deleteProps(obj, props) {
  Object.keys(obj).forEach(k => props.includes(k) && delete obj[k])
  return obj
}

export function syncProp(obj, k, v) {
  if (v === undefined) {
    return obj[k]
  }
  obj[k] = v
  return v
}

// NOTE only handles our nested params - nothing null 
// or undefined, no arrays, no empty subobjects, etc
export function flatten(obj) {
  const f = (obj, pre) => Object.entries(obj).reduce((acc, [k, v]) => ({
    ...acc,
    ...(typeof v === 'object' ? f(obj[k], pre + k + '.') : { [pre + k]: v })
  }), {})
  return f(obj, '')
}

export function unflatten(flat) {
  const add = (obj, [k, v]) => {
    const i = k.indexOf('.')
    if (i >= 0) {
      const [base, suf] = [k.slice(0, i), k.slice(i + 1)]
      obj[base] = add(obj[base] || {}, [suf, v])
    } else {
      obj[k] = v
    }
    return obj
  }
  return Object.entries(flat).reduce(add, {})
}

export function compress(obj) {
  const names = {}
  const getname = p =>
    p == '' ? '' : names[p] || (names[p] = `${Object.keys(names).length}`)
  const getpath = p => {
    const i = p.lastIndexOf('.')
    return i == -1 ? getname(p) : `${getname(p.slice(0, i))}.${getname(p.slice(i + 1))}`
  }
  const comp = {}
  Object.entries(obj).forEach(([k, v]) => comp[getpath(k)] = v)
  Object.entries(names).forEach(([k, v]) => comp[k] = v)
  return comp
}

export function uncompress(comp) {
  const [names, props] = [[], []]
  Object.entries(comp).forEach(([k, v]) => +k == k ? (props[k] = v) : (names[v] = k))
  const getpath = n => {
    const i = n.indexOf('.')
    return i == -1 ? names[n] : `${names[n.slice(0, i)] + '.' + names[n.slice(i + 1)]}`
  }
  const obj = {}
  Object.entries(props).forEach(([k, v]) => obj[getpath(k)] = v)
  return obj
}

export function copyTree(obj) {
  return unflatten({ ...flatten(obj) })
}

//
// misc THREE utils
//

export function disposeAndClear(obj) {
  obj.geometry && obj.geometry.dispose()
  obj.children && obj.children.map(disposeAndClear)
  obj.clear()
}

// text rendering

import * as typeface from './assets/droid_sans_regular.typeface.js'
import { FontLoader } from 'three/addons/loaders/FontLoader.js'

const font = new FontLoader().parse(typeface.data)

export function getText(msg, color = 0x006699, size = 1) {
  const shapes = font.generateShapes(msg, size)
  const geometry = new THREE.ShapeGeometry(shapes)
  geometry.computeBoundingBox()
  const matLite = new THREE.MeshBasicMaterial({
    color: color,
    side: THREE.DoubleSide
  })
  return new THREE.Mesh(geometry, matLite)
}
