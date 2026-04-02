"use client";

import { useState, useEffect } from "react";
import { UploadCloud, Image as ImageIcon, CheckCircle2, ArrowRight, Loader2, Download, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionType, JobStatus } from "@/core/types";
import { imageApi } from "../api/imageApi";
import { socket } from "@/core/lib/socket";

export function ImageProcessorClient() {
  const [file, setFile] = useState<File | null>(null);
  const [action, setAction] = useState<ActionType | null>(null);
  
  // States for tracking
  const [isUploading, setIsUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      resetAllStates();
    }
  };

  const resetAllStates = () => {
    setJobId(null);
    setJobStatus(null);
    setResultUrl(null);
  };

  // WebSocket Connection Management
  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    // Socket Event Listeners
    socket.on("connect", () => console.log("🟢 WebSocket Connected"));
    socket.on("disconnect", () => console.log("🔴 WebSocket Disconnected"));

    socket.on("job_update", (data: { status: JobStatus; resultUrl?: string; error?: string }) => {
      console.log("Task Update Received:", data);
      setJobStatus(data.status);

      if (data.status === "COMPLETED" && data.resultUrl) {
        setResultUrl(data.resultUrl);
        toast.success("Image Processing Complete!");
      } else if (data.status === "FAILED") {
        toast.error(data.error || "RabbitMQ Worker failed to process the image.");
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("job_update");
    };
  }, []);

  useEffect(() => {
    if (jobId && socket.connected) {
      socket.emit("join_job_room", jobId);
    }
  }, [jobId]);

  const startProcessing = async () => {
    if (!file || !action) return;
    
    setIsUploading(true);
    toast.loading("Sending to RabbitMQ Queue...", { id: "upload-toast" });

    try {
      const res = await imageApi.uploadImage(file, action);
      
      setJobId(res.jobId);
      setJobStatus("PENDING");
      toast.success("Job Queued Successfully!", { id: "upload-toast" });
      
    } catch (error) {
      console.error(error);
      toast.error("Failed to connect to backend server. Is Node.js running?", { id: "upload-toast" });
    } finally {
      setIsUploading(false);
    }
  };

  const processAnother = () => {
    setFile(null);
    setAction(null);
    resetAllStates();
  };

  return (
    <div className="space-y-8">
      {jobStatus === "COMPLETED" && resultUrl ? (
        <div className="p-10 rounded-2xl border-2 border-green-500 bg-green-50/50 dark:bg-green-950/20 text-center animate-in fade-in zoom-in duration-500">
          <CheckCircle2 className="w-20 h-20 text-green-500 mx-auto mb-4" />
          <h2 className="text-3xl font-black text-slate-800 dark:text-slate-100 mb-2">Success!</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-8">Your background task is complete via WebSockets.</p>
          <div className="flex gap-4 justify-center">
            <a 
              href={resultUrl} 
              download 
              className="py-3 px-6 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center gap-2 transition-colors"
            >
              <Download size={20} /> Download Result
            </a>
            <button 
              onClick={processAnother}
              className="py-3 px-6 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-bold transition-colors"
            >
              Process Another
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* STEP 1: UPLOAD */}
          <div className={`p-8 rounded-2xl border-2 transition-all duration-300 ${!file ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-900/10 shadow-md' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 opacity-70'} ${jobId && 'hidden'}`}>
            <div className="flex items-center gap-4 mb-6">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${!file ? 'bg-blue-600 text-white' : 'bg-green-500 text-white'}`}>
                {!file ? "1" : <CheckCircle2 size={16} />}
              </div>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">Upload Image</h3>
            </div>

            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              {file ? (
                <div className="text-center">
                  <ImageIcon className="w-12 h-12 text-green-500 mx-auto mb-2" />
                  <p className="font-semibold text-slate-700 dark:text-slate-300">{file.name}</p>
                  <button onClick={(e) => { e.preventDefault(); setFile(null); resetAllStates(); }} className="text-sm text-red-500 mt-2 hover:underline">
                    Remove File
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <UploadCloud className="w-12 h-12 text-blue-500 mx-auto mb-2" />
                  <p className="text-slate-600 dark:text-slate-400 font-medium">Click to select file (Max 10MB)</p>
                </div>
              )}
              <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} disabled={isUploading || !!jobId} />
            </label>
          </div>

          {/* STEP 2: CHOOSE ACTION */}
          <div className={`p-8 rounded-2xl border-2 transition-all duration-300 ${file && !action && !jobId ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-900/10 shadow-md' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950'} ${(!file || jobId) && 'opacity-50 pointer-events-none'}`}>
            <div className="flex items-center gap-4 mb-6">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${action ? 'bg-green-500 text-white' : file ? 'bg-blue-600 text-white' : 'bg-slate-300 dark:bg-slate-700 text-slate-500'}`}>
                {action ? <CheckCircle2 size={16} /> : "2"}
              </div>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">Select Processing Task</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => setAction("compress")}
                disabled={isUploading || !!jobId}
                className={`p-6 rounded-xl border-2 text-left transition-all ${action === "compress" ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-blue-400'}`}
              >
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-1">Compress Image</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400">Reduce file size via queue.</p>
              </button>
              <button
                onClick={() => setAction("png_to_webp")}
                disabled={isUploading || !!jobId}
                className={`p-6 rounded-xl border-2 text-left transition-all ${action === "png_to_webp" ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-blue-400'}`}
              >
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-1">Convert to WEBP</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400">Format conversion worker.</p>
              </button>
            </div>
          </div>

          {/* STEP 3: EXECUTE & LISTEN (WebSockets) */}
          <div className={`transition-all duration-300 ${(!file || !action) && 'opacity-50 pointer-events-none'}`}>
            {!jobId ? (
              <button 
                onClick={startProcessing}
                disabled={isUploading}
                className="w-full py-5 px-6 flex items-center justify-center gap-3 bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-2xl font-bold text-xl shadow-lg transition-all disabled:opacity-70"
              >
                {isUploading ? <Loader2 className="animate-spin" size={24} /> : "Send to RabbitMQ Worker"} 
                {!isUploading && <ArrowRight size={24} />}
              </button>
            ) : (
              <div className="p-8 rounded-2xl border-2 border-blue-500 bg-blue-50/50 dark:bg-blue-900/10 text-center">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">Processing in Background</h3>
                <p className="text-slate-600 dark:text-slate-400 mt-2 font-mono bg-slate-200 dark:bg-slate-800 inline-block px-3 py-1 rounded-md text-sm">
                  Job ID: {jobId}
                </p>
                <div className="mt-4 flex flex-col items-center justify-center gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400">
                    <AlertCircle size={16} /> Status: {jobStatus || "WAITING FOR RABBITMQ..."}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    Listening via WebSockets
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}