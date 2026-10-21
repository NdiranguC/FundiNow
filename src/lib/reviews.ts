export function canReviewJob(job: { status: string; rating: number | null }, customerId: string, userId: string | undefined) {
  return userId === customerId && job.status === "completed" && job.rating === null;
}