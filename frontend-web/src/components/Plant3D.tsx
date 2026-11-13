import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  CanvasTexture,
  CatmullRomCurve3,
  Group,
  Mesh,
  SRGBColorSpace,
  Vector3,
} from "three";
import { useShallow } from "zustand/react/shallow";
import { canAnimate, usePlcStore } from "../store/usePlcStore";
import { OUTPUT_NAMES, OUTPUT_TAGS } from "../lib/ladder";
import { Icon } from "./Icon";

const STEEL = "#71868f";
const PIPE = "#405961";
const MINT = "#60e9c3";
type Point = [number, number, number];
function Pipe({
  points,
  active = false,
  radius = 0.065,
  color = PIPE,
}: {
  points: Point[];
  active?: boolean;
  radius?: number;
  color?: string;
}) {
  const curve = useMemo(
    () =>
      new CatmullRomCurve3(
        points.map((point) => new Vector3(...point)),
        false,
        "catmullrom",
        0.12,
      ),
    [points],
  );
  return (
    <mesh>
      <tubeGeometry args={[curve, 48, radius, 10, false]} />
      <meshStandardMaterial
        color={active ? MINT : color}
        metalness={0.65}
        roughness={0.34}
        emissive={active ? "#1b947b" : "#000000"}
        emissiveIntensity={active ? 0.7 : 0}
      />
    </mesh>
  );
}
function Ring({
  position,
  radius = 1.02,
}: {
  position: Point;
  radius?: number;
}) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.035, 8, 64]} />
      <meshStandardMaterial color={STEEL} metalness={0.85} roughness={0.25} />
    </mesh>
  );
}
function Label({
  position,
  name,
  detail,
  active,
}: {
  position: Point;
  name: string;
  detail: string;
  active?: boolean;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("No se pudo crear la etiqueta de proceso 3D.");
    context.fillStyle = "rgba(13, 26, 35, 0.95)";
    context.beginPath();
    context.roundRect(3, 3, 506, 154, 12);
    context.fill();
    context.strokeStyle = "#3b5565";
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = active ? MINT : "#7796a8";
    context.fillRect(14, 3, 484, 5);
    context.textAlign = "center";
    context.fillStyle = active ? "#74d8b7" : "#c0d5e1";
    context.font = "500 46px monospace";
    context.fillText(name, 256, 74);
    context.fillStyle = "#8aa9ba";
    context.font = "22px sans-serif";
    context.fillText(detail, 256, 121, 470);
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    return result;
  }, [name, detail, active]);
  useEffect(() => {
    texture.needsUpdate = true;
    return () => texture.dispose();
  }, [texture]);
  return (
    <sprite
      position={position}
      scale={[1.6, 0.5, 1]}
      renderOrder={20}
      name={`label-${name}`}
      raycast={() => undefined}
    >
      <spriteMaterial
        map={texture}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}
function Pump({
  position,
  name,
  active,
}: {
  position: Point;
  name: string;
  active: boolean;
}) {
  const rotor = useRef<Group>(null);
  useFrame((_, dt) => {
    if (active && rotor.current) rotor.current.rotation.x += dt * 9;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.8, 0.15, 0.55]} />
        <meshStandardMaterial color="#23353d" metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.35, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.22, 0.22, 0.55, 24]} />
        <meshStandardMaterial
          color={active ? "#23a68d" : "#375d68"}
          metalness={0.65}
          roughness={0.35}
          emissive={active ? "#094c3d" : "#000"}
        />
      </mesh>
      <group ref={rotor} position={[0.31, 0.35, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.15, 0.035, 6, 20]} />
          <meshStandardMaterial color={active ? MINT : STEEL} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.04, 0.28, 0.04]} />
          <meshStandardMaterial color={STEEL} />
        </mesh>
      </group>
      <Label
        position={[0, 0.05, 0.65]}
        name={name}
        detail={active ? "EN MARCHA" : "BOMBA"}
        active={active}
      />
    </group>
  );
}
function Fermenter({
  running,
  stirring,
  filling,
  draining,
  sensorHigh,
  sensorLow,
}: {
  running: boolean;
  stirring: boolean;
  filling: boolean;
  draining: boolean;
  sensorHigh: boolean;
  sensorLow: boolean;
}) {
  const liquid = useRef<Mesh>(null);
  const blades = useRef<Group>(null);
  const bubbles = useRef<Group>(null);
  useFrame((state, dt) => {
    const level = usePlcStore.getState().level;
    const height = Math.max(0.015, level * 2.65);
    if (liquid.current) {
      liquid.current.scale.y = height;
      liquid.current.position.y = 0.65 + height / 2;
    }
    if (running && stirring && blades.current)
      blades.current.rotation.y += dt * 3.7;
    if (bubbles.current) {
      bubbles.current.visible = running && stirring;
      bubbles.current.children.forEach((bubble, index) => {
        const phase = (state.clock.elapsedTime * 0.24 + index * 0.127) % 1;
        bubble.position.set(
          Math.sin(index * 3.7) * 0.65,
          0.7 + phase * height,
          Math.cos(index * 2.3) * 0.65,
        );
      });
    }
  });
  return (
    <group position={[-1.65, 0, 0]}>
      {[-0.72, 0.72].flatMap((x) =>
        [-0.6, 0.6].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.35, z]}>
            <boxGeometry args={[0.11, 0.7, 0.11]} />
            <meshStandardMaterial color={STEEL} metalness={0.8} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.61, 0]}>
        <cylinderGeometry args={[1, 0.85, 0.2, 64]} />
        <meshStandardMaterial
          color="#5f727c"
          metalness={0.8}
          roughness={0.35}
        />
      </mesh>
      <mesh ref={liquid} position={[0, 1, 0]}>
        <cylinderGeometry args={[0.94, 0.94, 1, 64]} />
        <meshPhysicalMaterial
          color="#c78932"
          transparent
          opacity={0.78}
          metalness={0.1}
          roughness={0.23}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 1.98, 0]}>
        <cylinderGeometry args={[1, 1, 2.75, 64, 1, true]} />
        <meshPhysicalMaterial
          color="#92b5bf"
          metalness={0.15}
          roughness={0.08}
          transparent
          opacity={0.18}
          depthWrite={false}
          side={2}
        />
      </mesh>
      {[0.7, 1.3, 2.5, 3.3].map((y) => (
        <Ring position={[0, y, 0]} key={y} />
      ))}
      <mesh position={[0, 3.34, 0]}>
        <cylinderGeometry args={[0.76, 1.03, 0.22, 64]} />
        <meshStandardMaterial color={STEEL} metalness={0.82} roughness={0.3} />
      </mesh>
      <mesh position={[0, 3.63, 0]}>
        <boxGeometry args={[0.42, 0.43, 0.42]} />
        <meshStandardMaterial
          color={stirring ? "#3c9b8b" : "#41626d"}
          metalness={0.65}
          roughness={0.32}
        />
      </mesh>
      <group ref={blades}>
        <mesh position={[0, 2, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 2.75, 12]} />
          <meshStandardMaterial
            color="#b8c8cc"
            metalness={0.85}
            roughness={0.25}
          />
        </mesh>
        {[1.05, 1.8].map((y) => (
          <group position={[0, y, 0]} key={y}>
            {[0, Math.PI / 2].map((angle) => (
              <mesh key={angle} rotation={[0, angle, 0.18]}>
                <boxGeometry args={[1.5, 0.1, 0.16]} />
                <meshStandardMaterial
                  color="#9ab2b8"
                  metalness={0.8}
                  roughness={0.25}
                />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <group ref={bubbles}>
        {Array.from({ length: 12 }, (_, index) => (
          <mesh key={index}>
            <sphereGeometry args={[0.028 + (index % 3) * 0.009, 8, 8]} />
            <meshBasicMaterial color="#f3d9a5" transparent opacity={0.6} />
          </mesh>
        ))}
      </group>
      <mesh position={[1.03, 3.03, 0.12]}>
        <sphereGeometry args={[0.075, 12, 12]} />
        <meshStandardMaterial
          color={sensorHigh ? MINT : "#526774"}
          emissive={sensorHigh ? "#1c8c68" : "#000"}
        />
      </mesh>
      <mesh position={[1.03, 0.92, 0.12]}>
        <sphereGeometry args={[0.075, 12, 12]} />
        <meshStandardMaterial
          color={sensorLow ? MINT : "#526774"}
          emissive={sensorLow ? "#1c8c68" : "#000"}
        />
      </mesh>
      <Pipe
        points={[
          [-0.85, 3.4, 0],
          [-1.3, 3.4, 0],
          [-1.3, 0.42, 0],
          [-0.95, 0.42, 1.2],
        ]}
        active={filling}
      />
      <Pipe
        points={[
          [0.6, 0.65, 0.5],
          [0.6, 0.4, 1.3],
          [1.2, 0.4, 1.3],
        ]}
        active={draining}
      />
      <Label
        position={[0, 4.12, 0]}
        name="V-101"
        detail="CUBA DE FERMENTACIÓN"
        active={stirring || filling}
      />
    </group>
  );
}
function Column({ vapor, draining }: { vapor: boolean; draining: boolean }) {
  const steam = useRef<Group>(null);
  useFrame((state) => {
    if (steam.current) {
      steam.current.visible = vapor;
      steam.current.children.forEach((puff, index) => {
        const phase = (state.clock.elapsedTime * 0.35 + index / 7) % 1;
        puff.position.set(
          Math.sin(index * 4 + phase * 2) * 0.15,
          4.5 + phase * 1.0,
          0,
        );
        puff.scale.setScalar(0.1 + phase * 0.16);
      });
    }
  });
  return (
    <group position={[1.85, 0, -0.35]}>
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.7, 0.75, 0.3, 32]} />
        <meshStandardMaterial color="#2e434f" metalness={0.7} />
      </mesh>
      <mesh position={[0, 2.34, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 4.15, 40]} />
        <meshStandardMaterial
          color="#82969e"
          metalness={0.88}
          roughness={0.28}
        />
      </mesh>
      {[0.45, 1.2, 2, 2.8, 3.6, 4.35].map((y) => (
        <Ring position={[0, y, 0]} radius={0.44} key={y} />
      ))}
      <mesh position={[0, 4.43, 0]}>
        <sphereGeometry args={[0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={STEEL} metalness={0.8} roughness={0.3} />
      </mesh>
      <Pipe
        points={[
          [0, 4.4, 0],
          [0, 4.8, 0],
          [1, 4.8, 0],
          [1, 2, 0],
        ]}
        active={vapor}
        radius={0.09}
      />
      <Pipe
        points={[
          [-1.4, 0.4, 1.65],
          [-0.6, 0.4, 1.65],
          [-0.6, 1.4, 0],
          [0, 1.4, 0],
        ]}
        active={draining}
      />
      <mesh position={[1, 1.95, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 1.4, 24]} />
        <meshStandardMaterial color="#66858c" metalness={0.8} roughness={0.3} />
      </mesh>
      {[1.4, 1.7, 2, 2.3, 2.55].map((y) => (
        <Ring position={[1, y, 0]} radius={0.29} key={y} />
      ))}
      <Pipe
        points={[
          [1, 1.2, 0],
          [1, 0.38, 0],
          [1.7, 0.38, 0],
        ]}
        active={vapor}
      />
      <mesh position={[0.59, 2.2, -0.1]}>
        <boxGeometry args={[0.07, 3.9, 0.07]} />
        <meshStandardMaterial color={STEEL} metalness={0.8} />
      </mesh>
      <mesh position={[0.97, 2.2, -0.1]}>
        <boxGeometry args={[0.07, 3.9, 0.07]} />
        <meshStandardMaterial color={STEEL} metalness={0.8} />
      </mesh>
      {Array.from({ length: 13 }, (_, index) => (
        <mesh position={[0.78, 0.4 + index * 0.28, -0.1]} key={index}>
          <boxGeometry args={[0.43, 0.045, 0.08]} />
          <meshStandardMaterial color={STEEL} metalness={0.7} />
        </mesh>
      ))}
      <group ref={steam}>
        {Array.from({ length: 7 }, (_, index) => (
          <mesh key={index}>
            <sphereGeometry args={[1, 10, 8]} />
            <meshBasicMaterial
              color="#e0e8e9"
              transparent
              opacity={0.13}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
      <Label
        position={[0, 5.35, 0]}
        name="C-102"
        detail="DESTILACIÓN"
        active={vapor}
      />
      <Label
        position={[1.6, 2.4, 0]}
        name="E-102"
        detail="INTERCAMBIADOR"
        active={vapor}
      />
    </group>
  );
}
function Beacon({ active }: { active: boolean }) {
  const head = useRef<Group>(null);
  useFrame((_, dt) => {
    if (active && head.current) head.current.rotation.y += dt * 5;
  });
  return (
    <group position={[3.65, 0, -1.5]}>
      <mesh position={[0, 1.55, 0]}>
        <cylinderGeometry args={[0.045, 0.06, 3.1, 12]} />
        <meshStandardMaterial color={STEEL} />
      </mesh>
      <mesh position={[0, 3.12, 0]}>
        <cylinderGeometry args={[0.16, 0.17, 0.13, 20]} />
        <meshStandardMaterial color="#283d45" />
      </mesh>
      <mesh position={[0, 3.34, 0]}>
        <capsuleGeometry args={[0.13, 0.2, 4, 16]} />
        <meshStandardMaterial
          color={active ? "#ff554e" : "#5f252a"}
          emissive={active ? "#ff1710" : "#000"}
          emissiveIntensity={active ? 1.8 : 0}
        />
      </mesh>
      <group ref={head} position={[0, 3.35, 0]}>
        {active && (
          <pointLight
            position={[0.3, 0, 0]}
            color="#ff413b"
            intensity={5}
            distance={4}
          />
        )}
      </group>
    </group>
  );
}
function Console3D({ enabled }: { enabled: boolean }) {
  const setInput = usePlcStore((s) => s.setInput);
  const held = useRef<number | null>(null);
  function release(index: number) {
    if (held.current !== index) return;
    held.current = null;
    setInput(index, false);
  }
  return (
    <group position={[-0.4, 0, 2.6]}>
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[0.65, 0.8, 0.4]} />
        <meshStandardMaterial color="#354d58" metalness={0.65} />
      </mesh>
      <mesh position={[0, 0.83, 0]} rotation={[-0.2, 0, 0]}>
        <boxGeometry args={[0.85, 0.12, 0.55]} />
        <meshStandardMaterial color="#7c8e96" metalness={0.65} />
      </mesh>
      {[0, 1].map((index) => (
        <mesh
          key={index}
          position={[index ? 0.21 : -0.21, 0.93, 0.05]}
          onPointerDown={(event) => {
            event.stopPropagation();
            if (
              enabled &&
              !usePlcStore.getState().inputPending.includes(index)
            ) {
              held.current = index;
              setInput(index, true);
            }
          }}
          onPointerUp={() => release(index)}
          onPointerOut={() => release(index)}
        >
          <cylinderGeometry args={[0.1, 0.11, 0.08, 20]} />
          <meshStandardMaterial
            color={index ? "#d9534e" : "#41b58d"}
            emissive={enabled ? (index ? "#42100b" : "#12432e") : "#000"}
          />
        </mesh>
      ))}
    </group>
  );
}
function Scene() {
  const { telemetry, fresh, engine, health, virtualInputs } = usePlcStore(
    useShallow((s) => ({
      telemetry: s.telemetry,
      fresh: s.fresh,
      engine: s.engine,
      health: s.health,
      virtualInputs: s.virtualInputs,
    })),
  );
  const running = canAnimate({ telemetry, fresh, engine, health });
  const q = (index: number) => running && telemetry?.outputs[index] === true;
  return (
    <>
      <color attach="background" args={["#101b25"]} />
      <fog attach="fog" args={["#101b25", 16, 35]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#b1d3e4", "#1b2a36", 1.5]} />
      <directionalLight position={[2, 7, 4]} intensity={2.6} />
      <pointLight
        position={[-4, 4, -2]}
        color="#78c3dd"
        intensity={25}
        distance={15}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial
          color="#101c27"
          metalness={0.3}
          roughness={0.78}
        />
      </mesh>
      <gridHelper
        args={[24, 48, "#2c4653", "#1c303f"]}
        position={[0, -0.015, 0]}
      />
      <mesh position={[0, 0.015, 0]}>
        <boxGeometry args={[8.1, 0.05, 5.4]} />
        <meshStandardMaterial color="#1a2b37" metalness={0.3} roughness={0.6} />
      </mesh>
      <Fermenter
        running={running}
        filling={q(0)}
        stirring={q(1)}
        draining={q(3)}
        sensorHigh={fresh && telemetry?.inputs[2] === true}
        sensorLow={fresh && telemetry?.inputs[3] === true}
      />
      <Column vapor={q(2)} draining={q(3)} />
      <Pump position={[-2.6, 0.05, 1.4]} name="P_101" active={q(0)} />
      <Pump position={[-0.45, 0.05, 1.4]} name="P_102" active={q(3)} />
      <Beacon active={q(4)} />
      <Console3D enabled={fresh && virtualInputs === true} />
      <OrbitControls
        makeDefault
        target={[0, 2, 0]}
        minDistance={6}
        maxDistance={18}
        maxPolarAngle={Math.PI / 2.03}
        enableDamping
      />
    </>
  );
}
class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        <Icon name="warning" size={28} />
        <strong>No se pudo iniciar WebGL</strong>
        <p>
          Activa la aceleración gráfica del navegador. El editor y el pupitre
          siguen disponibles.
        </p>
        <button
          className="button subtle"
          onClick={() => this.setState({ failed: false })}
        >
          Reintentar escena
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function Plant3D() {
  const {
    level,
    setLevel,
    telemetry,
    fresh,
    engine,
    health,
    virtualInputs,
    sensorPending,
    sensorError,
  } = usePlcStore(
    useShallow((s) => ({
      level: s.level,
      setLevel: s.setLevel,
      telemetry: s.telemetry,
      fresh: s.fresh,
      engine: s.engine,
      health: s.health,
      virtualInputs: s.virtualInputs,
      sensorPending: s.sensorPending,
      sensorError: s.sensorError,
    })),
  );
  const [viewKey, setViewKey] = useState(0);
  const running = canAnimate({ telemetry, fresh, engine, health });
  return (
    <section className="panel plant-panel">
      <div className="panel-heading">
        <div className="heading-icon">
          <Icon name="cube" />
        </div>
        <div>
          <h2>Gemelo digital</h2>
          <p>Planta alcoholera · vista de proceso</p>
        </div>
        <span className={`badge ${running ? "badge-green" : "badge-neutral"}`}>
          <i className={`dot ${running ? "green" : "gray"}`} />
          {running ? "En ejecución" : "Física pausada"}
        </span>
      </div>
      <div className="plant-canvas">
        <SceneBoundary>
          <Suspense
            fallback={
              <div className="scene-fallback">Iniciando escena 3D…</div>
            }
          >
            <Canvas
              key={viewKey}
              camera={{ position: [7.5, 5.7, 8.5], fov: 43 }}
              dpr={[1, 1.75]}
              gl={{ antialias: true, alpha: false }}
            >
              <Scene />
            </Canvas>
          </Suspense>
        </SceneBoundary>
        <div className="scene-hud">
          <span>
            <i className={`dot ${fresh ? "green" : "amber"}`} />
            {fresh ? "TELEMETRÍA EN VIVO" : "SIN TELEMETRÍA VIGENTE"}
          </span>
          <span>
            HIL ·{" "}
            {virtualInputs === true
              ? sensorPending
                ? "sincronizando"
                : "sensores enviados"
              : "fuente virtual no confirmada"}
          </span>
        </div>
        <button
          className="scene-reset icon-button"
          title="Restablecer cámara"
          aria-label="Restablecer cámara 3D"
          onClick={() => setViewKey((key) => key + 1)}
        >
          <Icon name="refresh" size={16} />
        </button>
        <div className="scene-hint">
          Arrastra para orbitar · Rueda para acercar
        </div>
      </div>
      <div className="process-metrics">
        <div className="level-metric">
          <div>
            <span className="small-label">NIVEL VIRTUAL · V-101</span>
            <strong>
              {(level * 100).toFixed(1)}
              <small>%</small>
            </strong>
          </div>
          <div className="level-bar">
            <span style={{ width: `${level * 100}%` }} />
            <i style={{ left: "10%" }} />
            <i style={{ left: "90%" }} />
          </div>
          <div className="level-thresholds">
            <span>LSL &gt;10%</span>
            <span>LSH ≥90%</span>
          </div>
        </div>
        <div className="sensor-pair">
          <span>
            <i
              className={`dot ${fresh ? (telemetry?.inputs[2] ? "green" : "gray") : "amber"}`}
            />
            LSH_101 <b>{fresh ? Number(telemetry?.inputs[2]) : "?"}</b>
          </span>
          <span>
            <i
              className={`dot ${fresh ? (telemetry?.inputs[3] ? "green" : "gray") : "amber"}`}
            />
            LSL_101 <b>{fresh ? Number(telemetry?.inputs[3]) : "?"}</b>
          </span>
          <small>Bits observados por PLC</small>
        </div>
      </div>
      <div className="output-strip">
        {OUTPUT_TAGS.map((name, index) => (
          <div
            key={name}
            className={
              fresh && telemetry?.outputs[index] ? "output-active" : ""
            }
          >
            <span
              className={`dot ${fresh ? (telemetry?.outputs[index] ? "green" : "gray") : "amber"}`}
            />
            <strong>{name}</strong>
            <span>{OUTPUT_NAMES[index]}</span>
            <b>{fresh ? (telemetry?.outputs[index] ? "ON" : "OFF") : "—"}</b>
          </div>
        ))}
      </div>
      <details className="twin-settings">
        <summary>
          Ajustar nivel del gemelo <span>Configuración HIL</span>
        </summary>
        <label>
          Nivel inicial / manual{" "}
          <input
            aria-label="Nivel manual del gemelo en porcentaje"
            type="range"
            min="0"
            max="100"
            step="1"
            disabled={engine === true}
            value={level * 100}
            onChange={(e) => setLevel(Number(e.target.value) / 100)}
          />
          <span>{Math.round(level * 100)}%</span>
        </label>
        <p>
          {engine === true
            ? "Detén el motor para ajustar el nivel manualmente."
            : "Nivel local del modelo. Al confirmar entradas virtuales se sincronizan I[2] e I[3]."}{" "}
          La evolución requiere RUN confirmado y telemetría vigente. Caudales:
          +4,5 / −6 puntos %/s.
        </p>
      </details>
      {sensorError && (
        <p className="inline-error" role="alert">
          {sensorError}
        </p>
      )}
    </section>
  );
}
