import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaClient } from "@/generated/prisma/client";
import bcrypt from "bcrypt";

// ✅ Extend types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string;
      hallticket: string;
      role: "ADMIN" | "USER" | "SUPER_ADMIN";
      exp?: number;
      examroom?: string;
      examslot?: string;
      examdate?: string;
      // ❌ dob removed here
    };
  }

  interface User {
    id: string;
    name?: string;
    hallticket: string;
    role: "ADMIN" | "USER" | "SUPER_ADMIN";
    examroom: string;
    examslot: string;
    examdate: string;
    dob: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    name?: string;
    hallticket: string;
    role: "ADMIN" | "USER" | "SUPER_ADMIN";
    exp?: number;
    examroom: string;
    dob: string;
    examslot?: string;
    examdate?: string;
  }
}

const prisma = new PrismaClient();

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 45 * 60, // 45 minutes
  },

  pages: {
    signIn: "/login",
  },

  providers: [
    CredentialsProvider({
      credentials: {
        hallticket: {
          label: "Hall Ticket Number",
          type: "text",
          placeholder: "Enter your hall ticket number",
        },
        dob: {
          label: "Date of Birth",
          type: "date",
          placeholder: "Select your date of birth",
        },
        localIp: {
          label: "Local IP",
          type: "text",
        },
      },

      async authorize(credentials) {
        if (!credentials?.hallticket || !credentials?.dob) {
          throw new Error("Hall ticket number and date of birth are required.");
        }

        const localIp = credentials.localIp || "Unknown";

        try {
          const user = await prisma.user.findUnique({
            where: {
              hallticket: credentials.hallticket,
            },
            select: {
              id: true,
              name: true,
              hallticket: true,
              role: true,
              examroom: true,
              dob: true,
              examslot: true,
              examdate: true,
              isLoggedIn: true,
            },
          });

          if (!user) {
            throw new Error("Invalid hall ticket number or date of birth.");
          }

          if (user.isLoggedIn) {
            throw new Error(
              "Multiple login detected. This account is already logged in from another device/browser. Please contact the administrator if you believe this is an error."
            );
          }

          const [yyyy, mm, dd] = credentials.dob.split("-");
          const formattedDob = `${dd}-${mm}-${yyyy}`;

          const isDobMatch = await bcrypt.compare(formattedDob, user.dob);
          if (!isDobMatch) {
            throw new Error("Invalid hall ticket number or date of birth.");
          }

          await prisma.user.update({
            where: { id: user.id },
            data: {
              logedInAt: new Date(),
              ipAddress: localIp,
              isLoggedIn: true,
            },
          });

          return {
            id: user.id,
            name: user.name,
            hallticket: user.hallticket,
            role: user.role,
            examroom: user.examroom,
            dob: user.dob,
            examdate: user.examdate,
            examslot: user.examslot,
          };
        } catch (error) {
          console.error("Error in authorize:", error);
          throw error;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.hallticket = user.hallticket;
        token.role = user.role;
        token.examroom = user.examroom;
        token.dob = user.dob; // ✅ Only in token (server-side)
        token.exp = Math.floor(Date.now() / 1000) + 45 * 60;
        token.examdate = user.examdate;
        token.examslot = user.examslot;
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.name = token.name;
        session.user.hallticket = token.hallticket;
        session.user.role = token.role as "ADMIN" | "USER" | "SUPER_ADMIN";
        session.user.examroom = token.examroom;
        session.user.exp = token.exp;
        session.user.examdate = token.examdate;
        session.user.examslot = token.examslot;
      }
      return session;
    },
  },

  events: {
    async signOut({ token }) {
      if (token?.id) {
        try {
          await prisma.user.update({
            where: { id: token.id as string },
            data: {
              isLoggedIn: false,
            },
          });
        } catch (error) {
          console.error("Error updating logout status:", error);
        }
      }
    },
  },
};
