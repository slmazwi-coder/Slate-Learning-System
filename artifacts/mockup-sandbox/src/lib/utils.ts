/*
 * © 2026 Age thirty4 technologies. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying of this file, via any means, is strictly prohibited.
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
