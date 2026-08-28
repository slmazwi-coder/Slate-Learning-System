import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  assignmentsTable,
  assignmentSessionsTable,
  classesTable,
  db,
  learnersTable,
  submissionsTable,
  teachersTable,
} from "@workspace/db";
import { requireTeacher } from "../lib/teacher-auth";
import { parseScannedAssignment, parseDocumentAssignment, extractCurriculumSequence, type AssignmentQuestion } from "../lib/document-parser";

const router: IRouter = Router();

// FIX 3: Manual question creation
const CreateManualAssignmentBody = z.object({
  classIds: z.array(z.string().uuid()).min(1).max(30),
  title: z.string().trim().min(3).max(160),
  topic: z.string().trim().min(2).max(160),
  openAt: z.string().datetime({ offset: true }),
  closeAt: z.string().datetime({ offset: true }),
  markingMode: z.enum(["auto", "selective", "manual"]).default("auto"),
  autoMarkQuestions: z.array(z.number().int().min(0).max(49)).optional(),
  questions: z.array(z.object({
    type: z.enum(["multiple_choice", "short_answer", "long_answer", "true_false", "fill_blank", "match_columns"]),
    prompt: z.string().trim().min(5).max(1000),
    options: z.array(z.string().trim()).optional(),
    correctAnswer: z.string().trim().min(1).max(500),
    marks: z.number().int().min(1).max(50).default(5),
    concept: z.string().trim().optional(),
  })).min(1).max(50),
});

// FIX 3: Upload handwritten/scanned assignment
const UploadScannedAssignmentBody = z.object({
  classIds: z.array(z.string().uuid()).min(1).max(30),
  imageBase64: z.string().min(100), // minimum reasonable base64 length
  openAt: z.string().datetime({ offset: true }),
  closeAt: z.string().datetime({ offset: true }),
  markingMode: z.enum(["auto", "selective", "manual"]).default("auto"),
  autoMarkQuestions: z.array(z.number().int().min(0).max(49)).optional(),
});

// FIX 3: Upload document (PDF or DOCX)
const UploadDocumentAssignmentBody = z.object({
  classIds: z.array(z.string().uuid()).min(1).max(30),
  fileBase64: z.string().min(100),
  mimeType: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  openAt: z.string().datetime({ offset: true }),
  closeAt: z.string().datetime({ offset: true }),
  markingMode: z.enum(["auto", "selective", "manual"]).default("auto"),
  autoMarkQuestions: z.array(z.number().int().min(0).max(49)).optional(),
});

// Create assignment with manually typed questions
router.post("/tis/assignments/manual", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = CreateManualAssignmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check all required fields and question structure." });
  
  const data = parsed.data;
  const openAt = new Date(data.openAt);
  const closeAt = new Date(data.closeAt);
  if (closeAt <= openAt) return res.status(400).json({ error: "The close time must be after the open time." });
  
  const rows = await db
    .select()
    .from(classesTable)
    .where(and(eq(classesTable.teacherId, teacher.id), inArray(classesTable.id, data.classIds)));
  if (rows.length !== data.classIds.length) return res.status(404).json({ error: "One of those classes is not on your timetable." });
  
  const autoMarkQuestions = data.markingMode === "selective" ? (data.autoMarkQuestions ?? []) : [];
  
  try {
    const created = await db.insert(assignmentsTable).values(rows.map((row) => ({
      title: data.title,
      subject: row.subject,
      topic: data.topic,
      curriculumContext: `Grade ${row.grade} South African ${row.subject} (CAPS): ${data.topic}.`,
      openAt,
      closeAt,
      questionCount: data.questions.length,
      classId: row.id,
      createdByTeacherId: teacher.id,
      markingMode: data.markingMode,
      autoMarkQuestions,
      // FIX 3: Store questions as JSON for manual assignments
      questions: data.questions as any,
    }))).returning();
    
    return res.status(201).json({
      assignments: created.map((assignment) => ({
        id: assignment.id,
        classId: assignment.classId,
        title: assignment.title,
        subject: assignment.subject,
        topic: assignment.topic,
        openAt: assignment.openAt.toISOString(),
        closeAt: assignment.closeAt.toISOString(),
        questionCount: data.questions.length,
        markingMode: assignment.markingMode,
        autoMarkQuestions: assignment.autoMarkQuestions,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "manual assignment creation failed");
    return res.status(400).json({ error: "Could not create the assignment. Check that all details are valid." });
  }
});

// Upload handwritten/scanned assignment and auto-parse
router.post("/tis/assignments/upload-scan", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = UploadScannedAssignmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide image base64, class IDs, and times." });
  
  const data = parsed.data;
  const openAt = new Date(data.openAt);
  const closeAt = new Date(data.closeAt);
  if (closeAt <= openAt) return res.status(400).json({ error: "The close time must be after the open time." });
  
  const rows = await db
    .select()
    .from(classesTable)
    .where(and(eq(classesTable.teacherId, teacher.id), inArray(classesTable.id, data.classIds)));
  if (rows.length !== data.classIds.length) return res.status(404).json({ error: "One of those classes is not on your timetable." });
  
  try {
    // Use first class for subject/grade context
    const classRow = rows[0];
    const parsed_doc = await parseScannedAssignment(data.imageBase64, classRow.subject, classRow.grade);
    
    const autoMarkQuestions = data.markingMode === "selective" ? (data.autoMarkQuestions ?? []) : [];
    
    const created = await db.insert(assignmentsTable).values(rows.map((row) => ({
      title: parsed_doc.title,
      subject: row.subject,
      topic: parsed_doc.topic,
      curriculumContext: `Grade ${row.grade} South African ${row.subject} (CAPS): ${parsed_doc.topic}. Transcription notes: ${parsed_doc.transcriptionNotes || "None"}`,
      openAt,
      closeAt,
      questionCount: parsed_doc.questions.length,
      classId: row.id,
      createdByTeacherId: teacher.id,
      markingMode: data.markingMode,
      autoMarkQuestions,
      questions: parsed_doc.questions as any,
    }))).returning();
    
    return res.status(201).json({
      transcriptionNotes: parsed_doc.transcriptionNotes,
      assignments: created.map((assignment) => ({
        id: assignment.id,
        classId: assignment.classId,
        title: assignment.title,
        subject: assignment.subject,
        topic: assignment.topic,
        openAt: assignment.openAt.toISOString(),
        closeAt: assignment.closeAt.toISOString(),
        questionCount: parsed_doc.questions.length,
        markingMode: assignment.markingMode,
        autoMarkQuestions: assignment.autoMarkQuestions,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "scanned assignment parsing failed");
    return res.status(502).json({ error: "Could not parse the scanned assignment. Ensure the image is clear and contains visible questions." });
  }
});

// Upload document (PDF/DOCX) and auto-parse
router.post("/tis/assignments/upload-document", async (req, res) => {
  const teacher = await requireTeacher(req, res);
  if (!teacher) return;
  const parsed = UploadDocumentAssignmentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide file base64, MIME type, class IDs, and times." });
  
  const data = parsed.data;
  const openAt = new Date(data.openAt);
  const closeAt = new Date(data.closeAt);
  if (closeAt <= openAt) return res.status(400).json({ error: "The close time must be after the open time." });
  
  const rows = await db
    .select()
    .from(classesTable)
    .where(and(eq(classesTable.teacherId, teacher.id), inArray(classesTable.id, data.classIds)));
  if (rows.length !== data.classIds.length) return res.status(404).json({ error: "One of those classes is not on your timetable." });
  
  try {
    const classRow = rows[0];
    const parsed_doc = await parseDocumentAssignment(data.fileBase64, data.mimeType, classRow.subject, classRow.grade);
    
    const autoMarkQuestions = data.markingMode === "selective" ? (data.autoMarkQuestions ?? []) : [];
    
    const created = await db.insert(assignmentsTable).values(rows.map((row) => ({
      title: parsed_doc.title,
      subject: row.subject,
      topic: parsed_doc.topic,
      curriculumContext: `Grade ${row.grade} South African ${row.subject} (CAPS): ${parsed_doc.topic}.`,
      openAt,
      closeAt,
      questionCount: parsed_doc.questions.length,
      classId: row.id,
      createdByTeacherId: teacher.id,
      markingMode: data.markingMode,
      autoMarkQuestions,
      questions: parsed_doc.questions as any,
    }))).returning();
    
    return res.status(201).json({
      assignments: created.map((assignment) => ({
        id: assignment.id,
        classId: assignment.classId,
        title: assignment.title,
        subject: assignment.subject,
        topic: assignment.topic,
        openAt: assignment.openAt.toISOString(),
        closeAt: assignment.closeAt.toISOString(),
        questionCount: parsed_doc.questions.length,
        markingMode: assignment.markingMode,
        autoMarkQuestions: assignment.autoMarkQuestions,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "document assignment parsing failed");
    return res.status(502).json({ error: "Could not parse the document. Ensure it's a valid PDF or Word file with clear questions." });
  }
});

export default router;
