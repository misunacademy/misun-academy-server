export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export interface CourseContext {
  title: string;
  shortDescription: string;
  level: string;
  category: string;
}

export interface BatchContext {
  title: string;
  price: number;
  startDate: string;
  endDate: string;
  enrollmentStartDate: string;
  enrollmentEndDate: string;
  status: string;
  courseTitle?: string;
}

export interface SystemContext {
  courses: CourseContext[];
  batches: BatchContext[];
}
