export type ActionType = "compress" | "png_to_webp";
export type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface UploadResponse {
  jobId: string;
  message: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  originalName: string;
  resultUrl?: string;
  error?: string;
}