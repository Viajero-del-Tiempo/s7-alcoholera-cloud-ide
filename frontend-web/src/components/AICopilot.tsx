import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlcStore } from "../store/usePlcStore";
import { Icon } from "./Icon";

export function AICopilot() {
  const {
    chat,
    generate,
    generating,
    health,
    fresh,
    generatedDraft,
    applyGenerated,
  } = usePlcStore(
    useShallow((s) => ({
      chat: s.chat,
      generate: s.generate,
      generating: s.generating,
      health: s.health,
      fresh: s.fresh,
      generatedDraft: s.generatedDraft,
      applyGenerated: s.applyGenerated,
    })),
  );
  const [prompt, setPrompt] = useState("");
  const messages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messages.current?.scrollTo({
      top: messages.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat, generating]);
  function submit() {
    if (!prompt.trim() || generating) return;
    void generate(prompt.trim());
    setPrompt("");
  }
  return (
    <section className="panel copilot-panel">
      <div className="panel-heading">
        <div className="heading-icon purple">
          <Icon name="spark" />
        </div>
        <div>
          <h2>Copiloto de proceso</h2>
          <p>Describe el proceso. Revisa el Ladder.</p>
        </div>
        <span className="badge badge-purple">AI</span>
      </div>
      <div className="chat-messages" ref={messages} aria-live="polite">
        {!chat.length && (
          <div className="copilot-intro">
            <span className="copilot-avatar">
              <Icon name="spark" size={19} />
            </span>
            <p>
              Puedo preparar la lógica de llenado, fermentación temporizada,
              trasiego o alarma térmica.
              <br />
              <strong>El programa se genera como borrador.</strong>
            </p>
          </div>
        )}
        {chat.map((message, index) => (
          <div className={`chat-message ${message.role}`} key={index}>
            <span>{message.role === "operator" ? "OPERADOR" : "COPILOTO"}</span>
            <p>{message.text}</p>
          </div>
        ))}
        {generating && (
          <p className="generating">
            <i className="dot purple pulse" /> Generando y validando programa…
          </p>
        )}
      </div>
      {generatedDraft && (
        <div className="staged-result">
          <span>Resultado disponible: {generatedDraft.project_name}</span>
          <button className="button subtle" onClick={applyGenerated}>
            Cargar resultado
          </button>
        </div>
      )}
      <div className="prompt-chips">
        {[
          "Llenado automático",
          "Fermentación durante 15 segundos",
          "Trasiego automático",
          "Alarma térmica",
        ].map((text) => (
          <button
            key={text}
            disabled={generating}
            onClick={() => setPrompt(text)}
          >
            {text}
          </button>
        ))}
      </div>
      <form
        className="prompt-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Prompt del copiloto"
          placeholder="Ej. Fermentación durante 30 segundos…"
          value={prompt}
          maxLength={20000}
          rows={2}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          aria-label="Generar Ladder con IA"
          disabled={generating || !prompt.trim() || (!health && !fresh)}
        >
          <Icon name="arrow" size={18} />
        </button>
      </form>
      <div className="copilot-footnote">
        <Icon name="check" size={12} /> Generar no despliega · Enter para enviar
      </div>
    </section>
  );
}
