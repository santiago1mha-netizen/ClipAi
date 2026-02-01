"use client";

import { useState } from "react";

type Status = "idle" | "extracting" | "analyzing" | "generating" | "done" | "error";

interface Progress {
  status: Status;
  message: string;
  downloadUrl?: string;
  script?: string;
}

const STEPS = [
  { key: "extracting", label: "Extraindo vídeo e legendas" },
  { key: "analyzing", label: "Analisando conteúdo e criando roteiro" },
  { key: "generating", label: "Gerando short com narração" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [progress, setProgress] = useState<Progress>({ status: "idle", message: "" });

  const isProcessing = !["idle", "done", "error"].includes(progress.status);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isProcessing) return;

    try {
      // Step 1: Extract video and subtitles
      setProgress({ status: "extracting", message: "Baixando vídeo e extraindo legendas..." });
      const extractRes = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      
      if (!extractRes.ok) {
        const error = await extractRes.json();
        throw new Error(error.error || "Erro na extração");
      }
      const extractData = await extractRes.json();

      // Step 2: Analyze and create script
      setProgress({ status: "analyzing", message: "IA analisando o filme e criando roteiro..." });
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          videoId: extractData.videoId,
          subtitles: extractData.subtitles,
          title: extractData.title,
        }),
      });
      
      if (!analyzeRes.ok) {
        const error = await analyzeRes.json();
        throw new Error(error.error || "Erro na análise");
      }
      const analyzeData = await analyzeRes.json();

      // Step 3: Generate short video
      setProgress({ 
        status: "generating", 
        message: "Gerando narração e editando vídeo...",
        script: analyzeData.script,
      });
      const generateRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: extractData.videoId,
          script: analyzeData.script,
          scenes: analyzeData.scenes,
        }),
      });
      
      if (!generateRes.ok) {
        const error = await generateRes.json();
        throw new Error(error.error || "Erro na geração");
      }
      const generateData = await generateRes.json();

      setProgress({ 
        status: "done", 
        message: "Short criado com sucesso!", 
        downloadUrl: generateData.downloadUrl,
        script: analyzeData.script,
      });

    } catch (error) {
      setProgress({ 
        status: "error", 
        message: error instanceof Error ? error.message : "Erro desconhecido" 
      });
    }
  };

  const getStepStatus = (stepKey: string) => {
    const stepIndex = STEPS.findIndex(s => s.key === stepKey);
    const currentIndex = STEPS.findIndex(s => s.key === progress.status);
    
    if (progress.status === "done") return "done";
    if (progress.status === "error") return stepIndex <= currentIndex ? "error" : "pending";
    if (stepIndex < currentIndex) return "done";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  const reset = () => {
    setProgress({ status: "idle", message: "" });
    setUrl("");
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="max-w-2xl w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Shorts AI</h1>
          <p className="text-gray-400 text-sm sm:text-base">
            Transforme vídeos do YouTube em shorts automaticamente com IA
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="url" className="block text-sm font-medium mb-2">
              Link do YouTube
            </label>
            <input
              type="url"
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 transition text-sm sm:text-base"
              disabled={isProcessing}
            />
          </div>

          <button
            type="submit"
            disabled={isProcessing || !url.trim()}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium transition"
          >
            {isProcessing ? "Processando..." : "Criar Short"}
          </button>
        </form>

        {/* Progress Steps */}
        {progress.status !== "idle" && (
          <div className="p-4 sm:p-6 bg-gray-900 rounded-lg border border-gray-800 space-y-4">
            <div className="space-y-3">
              {STEPS.map((step, index) => {
                const status = getStepStatus(step.key);
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {status === "done" && (
                        <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center">
                          <span className="text-white text-sm">✓</span>
                        </div>
                      )}
                      {status === "active" && (
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      )}
                      {status === "pending" && (
                        <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center">
                          <span className="text-gray-400 text-xs">{index + 1}</span>
                        </div>
                      )}
                      {status === "error" && (
                        <div className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center">
                          <span className="text-white text-sm">✗</span>
                        </div>
                      )}
                    </div>
                    <span className={`text-sm ${
                      status === "done" ? "text-green-400" :
                      status === "active" ? "text-blue-400" :
                      status === "error" ? "text-red-400" :
                      "text-gray-500"
                    }`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Current Status Message */}
            {progress.message && (
              <div className={`text-sm p-3 rounded ${
                progress.status === "error" ? "bg-red-900/30 text-red-300" :
                progress.status === "done" ? "bg-green-900/30 text-green-300" :
                "bg-blue-900/30 text-blue-300"
              }`}>
                {progress.message}
              </div>
            )}

            {/* Script Preview */}
            {progress.script && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-400">Roteiro gerado:</h3>
                <p className="text-sm text-gray-300 bg-gray-800 p-3 rounded leading-relaxed">
                  {progress.script}
                </p>
              </div>
            )}

            {/* Download Button */}
            {progress.downloadUrl && (
              <a
                href={progress.downloadUrl}
                download
                className="block w-full py-3 bg-green-600 hover:bg-green-700 rounded-lg font-medium text-center transition"
              >
                Baixar Short
              </a>
            )}

            {/* Reset Button */}
            {(progress.status === "done" || progress.status === "error") && (
              <button
                onClick={reset}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
              >
                Criar outro short
              </button>
            )}
          </div>
        )}

        {/* Info */}
        <div className="text-center text-xs sm:text-sm text-gray-500 space-y-1">
          <p>O processo pode levar alguns minutos dependendo do tamanho do vídeo.</p>
          <p>Funciona melhor com filmes, séries e vídeos com diálogos.</p>
        </div>
      </div>
    </main>
  );
}
