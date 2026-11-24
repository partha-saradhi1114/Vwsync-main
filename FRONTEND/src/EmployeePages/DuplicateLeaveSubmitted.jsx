
import React from "react";
import { useNavigate } from "react-router-dom";
import "../css/DuplicateLeaveSubmitted.css";

const DuplicateLeaveSubmitted = () => {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate("/employee/leave-management");
  };

  return (
    <div className="duplicate-page">
      <div className="duplicate-card">

        <div className="duplicate-icon">
          !
        </div>

        <h2>Leave Request Already Submitted!</h2>

        <p>
          You have already submitted this leave request.
          Duplicate submissions are not allowed.
          Please check your leave history.
        </p>

        <button
          className="duplicate-ok-btn"
          onClick={handleBack}
        >
          OK
        </button>

      </div>
    </div>
  );
};

export default DuplicateLeaveSubmitted;
