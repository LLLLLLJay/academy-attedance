export type AttendanceType = 'checkin' | 'checkout';

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'retrying';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      academies: {
        Row: {
          id: string;
          name: string;
          admin_password_hash: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          admin_password_hash: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          admin_password_hash?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          academy_id: string;
          name: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          academy_id: string;
          name: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          academy_id?: string;
          name?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'students_academy_id_fkey';
            columns: ['academy_id'];
            isOneToOne: false;
            referencedRelation: 'academies';
            referencedColumns: ['id'];
          },
        ];
      };
      student_parents: {
        Row: {
          id: string;
          student_id: string;
          name: string | null;
          phone: string;
          phone_last4: string;
          is_primary: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          name?: string | null;
          phone: string;
          is_primary?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          name?: string | null;
          phone?: string;
          is_primary?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_parents_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
        ];
      };
      attendance_logs: {
        Row: {
          id: string;
          student_id: string;
          academy_id: string;
          type: AttendanceType;
          checked_at: string;
          memo: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          academy_id: string;
          type: AttendanceType;
          checked_at?: string;
          memo?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          academy_id?: string;
          type?: AttendanceType;
          checked_at?: string;
          memo?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'attendance_logs_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attendance_logs_academy_id_fkey';
            columns: ['academy_id'];
            isOneToOne: false;
            referencedRelation: 'academies';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_logs: {
        Row: {
          id: string;
          attendance_id: string;
          parent_id: string;
          status: NotificationStatus;
          attempt_count: number;
          next_retry_at: string | null;
          sent_at: string | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          attendance_id: string;
          parent_id: string;
          status?: NotificationStatus;
          attempt_count?: number;
          next_retry_at?: string | null;
          sent_at?: string | null;
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          attendance_id?: string;
          parent_id?: string;
          status?: NotificationStatus;
          attempt_count?: number;
          next_retry_at?: string | null;
          sent_at?: string | null;
          error_message?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_logs_attendance_id_fkey';
            columns: ['attendance_id'];
            isOneToOne: false;
            referencedRelation: 'attendance_logs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_logs_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'student_parents';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      attendance_type: AttendanceType;
      notification_status: NotificationStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

export type Academy = Tables<'academies'>;
export type Student = Tables<'students'>;
export type StudentParent = Tables<'student_parents'>;
export type AttendanceLog = Tables<'attendance_logs'>;
export type NotificationLog = Tables<'notification_logs'>;
