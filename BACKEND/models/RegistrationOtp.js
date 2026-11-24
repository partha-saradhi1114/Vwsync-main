import mongoose from "mongoose";

const registrationOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
    },
    otp: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 600, // The document will be automatically deleted after 10 minutes
    },
  },
  { timestamps: true }
);

const RegistrationOtp = mongoose.model("RegistrationOtp", registrationOtpSchema);
export default RegistrationOtp;
