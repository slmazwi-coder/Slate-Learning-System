/*
 * © 2026 Age thirty4 technologies. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying of this file, via any means, is strictly prohibited.
 */

import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
