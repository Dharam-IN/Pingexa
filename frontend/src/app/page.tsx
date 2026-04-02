import { ImageProcessorClient } from "@/features/image-processor/components/ImageProcessorClient";

export default function Home() {
  return (
    <div className="mt-8 p-6 max-w-4xl mx-auto">
      <div className="text-center mb-12 animate-in slide-in-from-bottom-4 duration-500">
        <h2 className="text-4xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
          Image Processing Pipeline
        </h2>
        <p className="mt-3 text-slate-500 dark:text-slate-400 font-medium">
          Powered by Node.js & RabbitMQ Background Workers
        </p>
      </div>

      <ImageProcessorClient />
    </div>
  );
}