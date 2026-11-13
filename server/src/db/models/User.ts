import { model, Schema, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    passwordHash: { type: String, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    isGuest: { type: Boolean, required: true, default: false },
    guestExpiresAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index(
  { guestExpiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { isGuest: true },
  },
);

export type UserRecord = InferSchemaType<typeof userSchema>;
export const UserModel = model('User', userSchema);
