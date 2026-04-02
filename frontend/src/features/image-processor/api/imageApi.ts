import { apiClient } from "@/core/lib/api";
import { UploadResponse, JobStatusResponse, ActionType } from "@/core/types";

export const imageApi = {
  uploadImage: async (file: File, action: ActionType): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("action", action);

    const response = await apiClient.post<UploadResponse>("/images/process", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },

};